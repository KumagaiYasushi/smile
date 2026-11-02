'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/client-api';
import { TASK_STATUS_LABELS } from '@/types/task';
import type { TaskMember } from '@/types/task';
import type { DeadlineDecision, ScheduleHistory, SchedulePreview } from '@/types/reschedule';
import { OCCURRENCE_LABELS } from '@/types/event-schedule';
import type { OccurrenceType } from '@/types/event-schedule';

const fieldClass = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2 text-sm';
async function loadPage(id: string, signal?: AbortSignal) {
  return Promise.all([apiJson(`/api/seminars/${id}`, { signal }), apiJson('/api/members', { signal }), apiJson(`/api/seminars/${id}/schedule-history`, { signal })]);
}

export default function ReschedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [name, setName] = useState('');
  const [occurrence, setOccurrence] = useState<OccurrenceType | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [originalDates, setOriginalDates] = useState<string[]>([]);
  const [baseDate, setBaseDate] = useState('');
  const [members, setMembers] = useState<TaskMember[]>([]);
  const [history, setHistory] = useState<ScheduleHistory[]>([]);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [decisions, setDecisions] = useState<Record<number, DeadlineDecision>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const choices = [...new Set(dates.filter(Boolean))];
  const effectiveBase = choices.includes(baseDate) ? baseDate : '';

  useEffect(() => {
    const controller = new AbortController();
    loadPage(id, controller.signal).then(([event, directory, audit]) => {
      setName(event.name); setOccurrence(event.occurrence_type); setDates(event.dates.length ? event.dates : ['']); setOriginalDates(event.dates);
      setBaseDate(event.dates.length === 1 ? event.dates[0] : ''); setMembers(directory.members); setHistory(audit.history); setLoading(false);
    }).catch((error) => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [id]);

  function changeDates(next: string[]) {
    const nextDates = [...new Set(next.filter(Boolean))];
    if (!nextDates.includes(baseDate)) setBaseDate(nextDates.length === 1 ? nextDates[0] : '');
    setDates(next); setPreview(null); setDecisions({}); setNotice('');
  }
  async function reload(force = false) {
    if (!force && !confirm('編集中の入力を破棄して、最新の内容を取得しますか？')) return;
    const [event, directory, audit] = await loadPage(id);
    setName(event.name); setOccurrence(event.occurrence_type); setDates(event.dates.length ? event.dates : ['']); setOriginalDates(event.dates);
    setBaseDate(event.dates.length === 1 ? event.dates[0] : ''); setMembers(directory.members); setHistory(audit.history); setPreview(null); setDecisions({});
  }
  async function refresh() {
    setBusy(true); setError('');
    try { await reload(); } catch (error) { setError(error instanceof Error ? error.message : '取得できませんでした'); }
    finally { setBusy(false); }
  }
  async function showPreview(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice(''); setPreview(null); setDecisions({});
    try { setPreview((await apiJson(`/api/seminars/${id}/schedule-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dates: dates.filter(Boolean), base_date: effectiveBase || null }) })).preview); }
    catch (error) { setError(error instanceof Error ? error.message : '取得できませんでした'); }
    finally { setBusy(false); }
  }
  async function apply(event: React.FormEvent) {
    event.preventDefault();
    if (!preview) return;
    if (preview.items.some((item) => !decisions[item.task_id])) { setError('全タスクの期限の扱いを選択してください'); return; }
    const updates = preview.items.filter((item) => decisions[item.task_id]?.action !== 'keep');
    if (!confirm(`開催日を「${preview.new_dates.join('、') || '日程未定'}」へ変更します。期限の更新対象は${updates.length}件（うち完了済み${updates.filter((item) => item.status === 'DONE').length}件）です。確定しますか？`)) return;
    setBusy(true); setError('');
    try {
      const result = await apiJson(`/api/seminars/${id}/reschedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dates: preview.new_dates, base_date: preview.base_date, preview_token: preview.preview_token, decisions: preview.items.map((item) => decisions[item.task_id]) }) });
      setNotice(result.replayed ? '前回の変更は完了しています。重複して更新していません。' : `開催日を変更し、${result.history.updated_task_ids.length}件の期限を更新しました`);
      setPreview(null); setDecisions({});
      try { await reload(true); } catch { setError('保存しましたが最新の内容を取得できませんでした。再取得してください。'); }
    } catch (error) { setError(error instanceof Error ? error.message : '変更できませんでした'); }
    finally { setBusy(false); }
  }

  if (loading) return <p className="py-12 text-center text-slate-500">読み込み中…</p>;
  return <div className="space-y-6">
    <div className="flex flex-wrap gap-4 text-sm"><Link href={`/seminars/${id}`} className="text-sky-700">← イベント詳細へ</Link><Link href={`/seminars/${id}/tasks`} className="text-sky-700 underline">タスク・期限管理</Link></div>
    <div><h1 className="text-2xl font-bold text-slate-800">開催日・期限変更</h1><p className="mt-1 text-slate-500">{name}</p></div>
    <p className="text-sm text-slate-600">変更後の日程を入力し、全タスクの期限を確認してから確定します。完了済み・個別に変更した期限の扱いも、今回の操作で選択してください。</p>
    <p className="text-sm text-slate-600">新しい開催日の出欠予定は未回答になります。変更後は<Link href={`/seminars/${id}/staff-attendance`} className="text-sky-800 underline">講師・サポートの出欠予定</Link>を確認してください。</p>
    <p className="text-sm text-slate-600">昼食の注文日と懇親会日時は自動で変更しません。日程変更後は<Link href={`/seminars/${id}/lunch`} className="text-sky-800 underline">昼食の手配</Link>とイベント詳細の懇親会情報を確認してください。</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{notice}</p>}
    <button disabled={busy} onClick={refresh} className="rounded-lg border bg-white px-4 py-2 text-sm">最新の内容を取得</button>
    <form onSubmit={showPreview} className="space-y-4 rounded-xl border bg-white p-5">
      <p className="text-sm">開催回数：{occurrence ? OCCURRENCE_LABELS[occurrence] : '未設定'}。開催回数の選択・変更は<Link href={`/seminars/${id}/edit`} className="text-sky-800 underline">イベント編集</Link>から行います。</p>
      <p className="text-sm text-slate-500">新しい開催日は年月日のみで登録します。時刻は日程変更後、イベント編集から任意で設定できます。</p>
      <p className="text-sm">現在の開催日：{originalDates.join('、') || '日程未定'}</p>
      <fieldset disabled={busy} className="space-y-3">
        <legend className="mb-3 font-bold">変更後の開催日</legend>
        {dates.map((date, index) => <div key={index} className="flex items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">開催日 {index + 1}<input type="date" value={date} onChange={(e) => changeDates(dates.map((value, i) => i === index ? e.target.value : value))} className={fieldClass} /></label>
          <button type="button" onClick={() => changeDates(dates.filter((_, i) => i !== index))} className="rounded-lg border px-3 py-2 text-sm">削除</button>
        </div>)}
        {occurrence === 'MULTIPLE' && <button type="button" disabled={dates.length >= 100} onClick={() => changeDates([...dates, ''])} className="text-sm text-sky-700 underline">＋ 日程を追加</button>}
        <label className="block max-w-md text-sm">逆算する期限の基準日<select aria-label="逆算する期限の基準日" value={effectiveBase} onChange={(e) => { setBaseDate(e.target.value); setPreview(null); setDecisions({}); }} className={fieldClass}><option value="">基準日を選択しない</option>{choices.map((date) => <option key={date} value={date}>{date}</option>)}</select></label>
        <p className="text-sm text-slate-500">テンプレート生成時の日数を使って計算します。基準日がない場合は、期限の保持または個別指定を選べます。</p>
      </fieldset>
      <button disabled={busy || !name || !occurrence} className="rounded-lg bg-sky-800 px-4 py-2 font-bold text-white disabled:opacity-50">変更内容をプレビュー</button>
    </form>
    {preview && <form onSubmit={apply} className="space-y-4">
      <h2 className="text-xl font-bold">期限の変更前後を確認</h2>
      <p className="rounded-lg bg-sky-50 p-3 text-sm">開催日：{preview.old_dates.join('、') || '日程未定'} → {preview.new_dates.join('、') || '日程未定'}<br />全タスクで扱いを選択してください。未選択のままでは確定できません。</p>
      <div className="flex flex-wrap gap-3 text-sm">
        <button type="button" disabled={busy} onClick={() => setDecisions(Object.fromEntries(preview.items.map((item) => [item.task_id, { task_id: item.task_id, action: 'keep' }]))) } className="rounded-lg border bg-white px-3 py-2">すべての期限を保持</button>
        <button type="button" disabled={busy} onClick={() => setDecisions((current) => ({ ...current, ...Object.fromEntries(preview.items.filter((item) => item.proposed_due_date !== null).map((item) => [item.task_id, { task_id: item.task_id, action: 'proposed' }])) }))} className="rounded-lg border bg-white px-3 py-2">算出できる提案期限をすべて採用</button>
      </div>
      <p className="text-xs text-slate-500">一括採用には完了済み・個別変更済みのタスクも含みます。各行を確認し、必要に応じて保持へ変更してください。</p>
      {!preview.items.length && <p>確認対象のタスクはありません。開催日のみを変更します。</p>}
      <div className="grid items-start gap-4 lg:grid-cols-2">{preview.items.map((item) => {
        const decision = decisions[item.task_id];
        return <section key={item.task_id} className="min-w-0 rounded-xl border bg-white p-5 space-y-3">
          <div className="flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-slate-100 px-2 py-1">{TASK_STATUS_LABELS[item.status]}</span>{item.important && <span className="rounded-full bg-amber-100 px-2 py-1">重要</span>}{item.manually_changed && <span className="rounded-full bg-amber-100 px-2 py-1">生成後に期限変更あり</span>}</div>
          <h3 className="break-words font-bold">{item.title}</h3>
          <p className="text-sm">現在の期限：{item.current_due_date ?? '未設定'}<br />提案期限：{item.proposed_due_date ?? '逆算なし'}</p>
          {item.source === 'template' ? <p className="text-xs text-slate-500">前回の基準日：{item.source_base_date}・相対日数：{item.relative_days}</p> : <p className="text-xs text-slate-500">手動で登録されたタスクです。期限を保持するか、個別に指定してください。</p>}
          <label className="block text-sm">今回の期限の扱い<select aria-label="今回の期限の扱い" required disabled={busy} value={decision?.action ?? ''} onChange={(e) => {
            const action = e.target.value;
            setDecisions((current) => {
              const next = { ...current };
              if (!action) delete next[item.task_id];
              else next[item.task_id] = action === 'custom' ? { task_id: item.task_id, action: 'custom', due_date: item.current_due_date } : { task_id: item.task_id, action: action as 'keep' | 'proposed' };
              return next;
            });
          }} className={fieldClass}><option value="">選択してください</option><option value="keep">現在の期限を保持</option>{item.proposed_due_date && <option value="proposed">提案期限を採用</option>}<option value="custom">期限を個別指定</option></select></label>
          {decision?.action === 'custom' && <label className="block text-sm">指定する期限（空欄は期限未設定）<input type="date" disabled={busy} value={decision.due_date ?? ''} onChange={(e) => setDecisions((current) => ({ ...current, [item.task_id]: { task_id: item.task_id, action: 'custom', due_date: e.target.value || null } }))} className={fieldClass} /></label>}
        </section>;
      })}</div>
      <button disabled={busy} className="rounded-lg bg-sky-800 px-5 py-3 font-bold text-white disabled:opacity-50">確認して日程・期限を変更</button>
    </form>}
    <section className="space-y-3 border-t pt-6">
      <h2 className="text-lg font-bold">日程変更の履歴</h2>
      {!history.length && <p className="text-sm text-slate-500">変更履歴はありません</p>}
      <ol className="space-y-3">{history.map((entry) => <li key={entry.id} className="space-y-1 rounded-xl border bg-white p-4 text-sm">
        <p>{new Date(entry.occurred_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}（日本時間）</p>
        <p>{entry.old_dates.join('、') || '日程未定'} → {entry.new_dates.join('、') || '日程未定'}</p>
        <p>期限更新 {entry.updated_task_ids.length}件・保持選択 {entry.decisions.filter((item) => item.action === 'keep').length}件</p>
        <p className="break-all text-slate-500">操作：{members.find((member) => member.id === entry.actor_id)?.email ?? `アカウント #${entry.actor_id}`}</p>
      </li>)}</ol>
    </section>
  </div>;
}
