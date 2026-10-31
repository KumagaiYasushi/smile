import Link from 'next/link';
import { notFound } from 'next/navigation';
import { registrationPageStore } from '@/lib/registration-page';
import { EventError } from '@/lib/event-store';
import { eventPageStore } from '@/lib/event-page';
import { ParticipantEditor } from '@/components/RegistrationForms';
import { APPLICATION_LABELS, MATCH_LABELS } from '@/types/registration';

export default async function ParticipantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  const store = await registrationPageStore(); let participant;
  try { participant = store.detail(Number(id)); } catch (error) { if (error instanceof EventError && error.status === 404) notFound(); throw error; }
  const members = (await eventPageStore()).members();
  const labels = { name: '氏名', mobile: '携帯', email: 'メール', workplace: '勤務先' };
  const date = (value: string) => new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return <div className="space-y-6">
    <Link href="/participants" className="text-sky-800 underline">参加者一覧へ</Link>
    <h1 className="text-2xl font-bold">{participant.current_name.trim() || '氏名未登録'}の履歴</h1>
    <ParticipantEditor key={participant.version} participant={{ id: participant.id, current_name: participant.current_name, current_mobile: participant.current_mobile, current_email: participant.current_email, current_workplace: participant.current_workplace, version: participant.version, created_at: participant.created_at }} />
    <section className="space-y-4"><h2 className="text-xl font-bold">イベント別の申込時情報</h2><p className="text-sm text-slate-600">申込時点の記録です。現在の代表情報とは別に保存しています。出欠は未確認です。</p>
      {participant.registrations.map(registration => <article key={registration.id} className="rounded-xl border bg-white p-5 space-y-2">
        <Link href={`/events/${registration.event_id}/registrations`} className="font-bold text-sky-800 underline">{registration.event_title}</Link><p className="text-sm">記録日時：{date(registration.created_at)} · {APPLICATION_LABELS[registration.application_status]} · {MATCH_LABELS[registration.match_status]}</p>
        <dl className="grid gap-3 sm:grid-cols-2">{Object.entries(labels).map(([key, label]) => <div key={key}><dt className="text-xs text-slate-600">{label}</dt><dd className="break-all">{registration.snapshot[key as keyof typeof labels] || '未入力'}</dd></div>)}</dl>
        {registration.candidate_ids.length > 0 && <p className="text-amber-800 text-sm">照合候補あり。統合は行っていません。</p>}
      </article>)}
    </section>
    <section className="space-y-4"><h2 className="text-xl font-bold">代表情報の変更履歴</h2>{participant.revisions.map(revision => <article key={revision.version} className="rounded-xl border bg-white p-5 space-y-2"><p className="text-sm">{date(revision.occurred_at)} · {members.find(member => member.id === revision.actor_id)?.name ?? '登録メンバー'} · {revision.before ? '代表情報を更新' : '初回登録'}</p>{revision.changed_fields.map(key => <p key={key} className="text-sm break-all">{labels[key]}：{revision.before?.[key] || '未入力'} → {revision.after[key] || '未入力'}</p>)}</article>)}</section>
  </div>;
}
