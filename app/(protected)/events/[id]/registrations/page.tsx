import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eventPageStore } from '@/lib/event-page';
import { registrationPageStore } from '@/lib/registration-page';
import { EventError } from '@/lib/event-store';
import { RegistrationForm } from '@/components/RegistrationForms';
import { ADMISSION_LABELS, APPLICATION_LABELS, MATCH_LABELS } from '@/types/registration';
import { CapacityEditor, ConfirmRegistration } from '@/components/AdmissionControls';

export default async function RegistrationsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  const events = await eventPageStore(); let event;
  try { event = events.get(Number(id)); } catch (error) { if (error instanceof EventError && error.status === 404) notFound(); throw error; }
  const store = await registrationPageStore(), registrations = store.forEvent(event.id);
  const admission = store.admission(event.id), history = store.admissionHistory(event.id), members = events.members();
  const date = (value: string) => new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return <div className="space-y-6">
    <Link href={`/events/${event.id}`} className="text-sky-800 underline">イベント詳細へ</Link>
    <h1 className="text-2xl font-bold">{event.title} · 申込情報</h1>
    <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">申込情報を確認してから、残席と締切の範囲内で受付を確定できます。受付確定は入金・出席の確認ではありません。キャンセル待ち・取消・実送信は未対応です。</p>
    <section className="rounded-xl border bg-white p-5 grid gap-6 md:grid-cols-2">
      <div className="space-y-3"><h2 className="text-lg font-bold">受付状況：{ADMISSION_LABELS[admission.state]}</h2><p>定員：{admission.capacity ?? '未設定'} · 受付確定：{admission.confirmed_count}人 · 残席：{admission.remaining ?? '未定'}</p><p>受付確認待ち：{admission.pending_count}件</p><p>申込締切：{admission.deadline ? date(admission.deadline) : '未設定（日時による停止なし）'}</p><p className="text-sm text-slate-600">確定操作時にもサーバーで残席・締切を再確認します。定員に達した場合、または締切到来で新しい確定を停止します。</p></div>
      <CapacityEditor key={admission.event_version} admission={admission} />
    </section>
    <RegistrationForm eventId={event.id} />
    <h2 className="text-xl font-bold">申込記録 {registrations.length}件</h2>
    {!registrations.length && <p>申込情報はまだありません。</p>}
    <div className="grid gap-4 md:grid-cols-2">{registrations.map(registration => <article key={registration.id} className="rounded-xl border bg-white p-5 space-y-2">
      <Link href={`/participants/${registration.participant_id}`} className="font-bold text-sky-800 underline">{registration.snapshot.name.trim() || '氏名未登録'}</Link>
      <p className="text-xs text-slate-500">記録日時：{date(registration.created_at)} · {APPLICATION_LABELS[registration.application_status]} · 出欠未確認</p>
      {registration.confirmed_at && <p className="text-sm text-green-800">確定：{date(registration.confirmed_at)} · {members.find(member => member.id === registration.confirmed_by)?.name ?? '登録メンバー'}</p>}
      <p className="text-sm">{registration.snapshot.mobile || '携帯未入力'}</p><p className="text-sm break-all">{registration.snapshot.email || 'メール未入力'}</p><p className="text-sm">{registration.snapshot.workplace || '勤務先未入力'}</p>
      <p className={`text-sm ${registration.match_status === 'AMBIGUOUS' ? 'text-amber-800 font-bold' : 'text-slate-600'}`}>{MATCH_LABELS[registration.match_status]}</p>
      {registration.candidate_ids.length > 0 && <div className="text-sm text-amber-800"><p>自動統合せず、新しい参加者として記録しました。確認候補：</p><div className="flex flex-wrap gap-3">{registration.candidate_ids.map((candidate, index) => <Link key={candidate} href={`/participants/${candidate}`} className="underline">候補{index + 1}の履歴</Link>)}</div><p>統合・分離の手順は未決定です。</p></div>}
      <ConfirmRegistration key={`${registration.id}-${registration.application_status}-${admission.event_version}`} registration={registration} admission={admission} />
    </article>)}</div>
    <section className="rounded-xl border bg-white p-5 space-y-3"><h2 className="text-lg font-bold">受付・定員の操作履歴（最新100件）</h2>{history.length === 0 && <p>操作履歴はまだありません。</p>}{history.map(row => <p key={row.id} className="text-sm border-b pb-2">{date(row.occurred_at)} · {members.find(member => member.id === row.actor_id)?.name ?? '登録メンバー'} · {row.action === 'CONFIRMED' ? '受付を確定' : `定員変更：${row.before_capacity ?? '未設定'} → ${row.after_capacity}人`}</p>)}</section>
  </div>;
}
