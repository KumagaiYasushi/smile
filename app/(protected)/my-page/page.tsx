'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/client-api';
import { EVENT_ROLES } from '@/types/event-roles';
import { EVENT_COLORS } from '@/types/event-colors';
import { EVENT_TYPE_LABELS } from '@/types/seminar';
import { SOCIETY_ROLE_LABELS } from '@/types/society-member';
import { TASK_STATUS_LABELS } from '@/types/task';
import { ROSTER_RESPONSE_LABELS } from '@/types/staff-roster';
import { attendanceDateKeys } from '@/types/staff-attendance';
import type { MemberPageData, MemberEvent, MemberTask } from '@/types/member-page';
import type { RosterResponse } from '@/types/staff-roster';
import type { TaskStatus } from '@/types/task';

const storageKey = 'smile-member-page-selection';
const field = 'mt-1 block min-h-11 w-full min-w-0 rounded-lg border-2 border-slate-400 bg-white p-2 text-base text-slate-950 focus:border-sky-700 focus:outline-2 focus:outline-sky-700 disabled:bg-slate-100';
export default function MemberPage() {
  const [data, setData] = useState<MemberPageData | null>(null), [selection, setSelection] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [includePast, setIncludePast] = useState(false), [needsAction, setNeedsAction] = useState(false);
  const requestNumber = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    let stored = ''; try { stored = localStorage.getItem(storageKey) ?? ''; } catch { /* Optional preference. */ }
    async function init() {
      try {
        const directory: MemberPageData = await apiJson('/api/member-page', { signal: controller.signal });
        const initial: MemberPageData = directory.members.some(p => String(p.id) === stored)
          ? await apiJson(`/api/member-page?member_id=${stored}`, { signal: controller.signal }) : directory;
        if (!controller.signal.aborted) { setData(initial); setSelection(initial.member ? String(initial.member.id) : ''); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : '取得できませんでした'); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void init(); return () => controller.abort();
  }, []);
  async function load(id: string) {
    const number = ++requestNumber.current;
    setLoading(true); setError(''); setNotice(''); setSelection(id);
    try {
      const result: MemberPageData = await apiJson(`/api/member-page${id ? `?member_id=${id}` : ''}`);
      if (number !== requestNumber.current) return;
      setData(result);
      try { if (id) localStorage.setItem(storageKey, id); else localStorage.removeItem(storageKey); } catch { /* Optional preference. */ }
    } catch (e) { if (number === requestNumber.current) setError(e instanceof Error ? e.message : '取得できませんでした'); }
    finally { if (number === requestNumber.current) setLoading(false); }
  }
  async function change(event: MemberEvent, action: 'attendance' | 'task', input: object, message: string, taskId?: number) {
    if (!data?.member || loading || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result: MemberPageData = await apiJson(`/api/member-page/${data.member.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, event_id: event.id, ...(taskId ? { task_id: taskId } : {}), data: input }) });
      setData(result); setNotice(message);
    } catch (e) { setError(e instanceof Error ? e.message : '保存できませんでした'); }
    finally { setBusy(false); }
  }
  function attendance(event: MemberEvent, date: string, response: RosterResponse) {
    const warning = event.speaking_dates.includes(date) && ['ABSENT', 'AM_ONLY', 'PM_ONLY'].includes(response);
    if (warning && !confirm(`${data!.member!.name}さんは${date || 'このイベント'}の演者として登録されています。「${ROSTER_RESPONSE_LABELS[response]}」に変更しますか？登壇予定を確認してください。`)) return;
    void change(event, 'attendance', { member_version: event.attendance.member_version, version: event.attendance.version, date, response, schedule: event.dates, confirm_speaker: warning }, '出欠を保存しました');
  }
  function taskStatus(event: MemberEvent, task: MemberTask, status: TaskStatus) {
    void change(event, 'task', { status, version: task.version, link_version: task.role_link.version, role_version: event.role_version }, 'タスク進捗を保存しました', task.id);
  }
  const valid = data?.member && String(data.member.id) === selection;
  const allEvents = valid ? data.events : [];
  const events = allEvents.filter(e => (includePast || !e.past || e.tasks.some(t => t.status !== 'DONE')) && (!needsAction || e.alerts.length > 0));
  const counts: [string, number, string][] = [
    ['対応が必要', allEvents.reduce((n, e) => n + e.alerts.length, 0), 'border-amber-400 bg-amber-50'],
    ['未完了タスク', allEvents.reduce((n, e) => n + e.tasks.filter(t => t.status !== 'DONE').length, 0), 'border-sky-300 bg-sky-50'],
    ['今後の役割', allEvents.filter(e => !e.past).reduce((n, e) => n + e.roles.length, 0), 'border-violet-300 bg-violet-50'],
  ];
  return <div data-member-editor className="space-y-5 text-slate-900">
    <div><h1 className="text-2xl font-bold">メンバー個人ページ</h1><p className="mt-2 text-sm text-slate-700">名簿から自分の名前を選ぶと、各イベントの出欠・役割・担当タスクをまとめて確認できます。</p></div>
    <section aria-label="表示するメンバー" className="rounded-2xl border border-sky-300 bg-sky-50 p-4">
      <label className="block max-w-lg font-bold">自分の名前<select aria-label="自分の名前" value={selection} disabled={busy || loading} onChange={e => void load(e.target.value)} className={field}>
        <option value="">名前を選択してください</option>{data?.members.map(p => <option key={p.id} value={p.id}>{p.name}（{SOCIETY_ROLE_LABELS[p.role]}）</option>)}
      </select></label>
      <p className="mt-3 text-sm text-slate-700">個別のアカウント登録は不要です。選んだ名前はこのブラウザに記憶します。役割の割り当ては運営画面で管理します。</p>
    </section>
    {(error || notice) && <div>{error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-red-900">{error} 保存済みの内容を確認するには「最新情報を取得」を押してください。</p>}{notice && <p role="status" className="rounded-xl border border-green-300 bg-green-50 p-3 text-green-900">{notice}</p>}</div>}
    <button type="button" disabled={loading || busy} onClick={() => void load(selection)} className="min-h-11 rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-bold disabled:opacity-50">最新情報を取得</button>
    {loading && <p role="status" className="py-6">読み込み中…</p>}
    {!loading && valid && <>
      <h2 className="text-xl font-bold">{data.member!.name}さんの予定・担当</h2>
      <div className="grid grid-cols-3 gap-2" aria-label="担当とアラートの件数">{counts.map(([label, count, color]) => <div key={label} className={`min-w-0 rounded-xl border p-3 ${color}`}><p className="break-words text-xs font-bold sm:text-sm">{label}</p><p className="mt-1 text-2xl font-bold">{count}<span className="ml-1 text-xs">件</span></p></div>)}</div>
      <div className="flex flex-wrap gap-x-5 gap-y-3 rounded-xl border border-slate-300 bg-white p-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={needsAction} onChange={e => setNeedsAction(e.target.checked)} className="h-4 w-4"/>対応が必要なイベントだけ</label><label className="flex items-center gap-2"><input type="checkbox" checked={includePast} onChange={e => setIncludePast(e.target.checked)} className="h-4 w-4"/>過去のイベントも表示</label></div>
      <p className="text-sm text-slate-700">{events.length}件表示。過去のイベントも未完了の担当タスクがあれば表示します。タスクは運営画面で連動する役割を設定すると表示されます。</p>
      <div className="space-y-4">{events.map(event => <article key={event.id} data-member-event={event.id} className={`min-w-0 overflow-hidden rounded-2xl border-2 ${EVENT_COLORS[event.event_type].card}`}>
        <header className="space-y-2 border-b border-slate-300 p-4">
          <div className="flex flex-wrap gap-2 text-xs font-bold"><span className={`rounded-full border px-2 py-1 ${EVENT_COLORS[event.event_type].badge}`}>{EVENT_TYPE_LABELS[event.event_type]}</span>{event.past && <span className="rounded-full bg-slate-700 px-2 py-1 text-white">過去のイベント</span>}</div>
          <h3 className="break-words text-lg font-bold"><Link href={`/seminars/${event.id}`} className="underline decoration-slate-400 underline-offset-4">{event.name}</Link></h3><p className="break-words text-sm">{event.dates.join('・') || '日程未定'}</p>
          <div className="flex flex-wrap gap-2 text-sm">{event.roles.map(p => <span key={`${p.role}:${p.date}`} className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-medium">{p.date === null ? '準備' : p.date || '日程未定'}：{EVENT_ROLES[p.role]}</span>)}{event.speaking_dates.length > 0 && <span className="rounded-lg border border-slate-300 bg-white px-2 py-1 font-medium">演者：{event.speaking_dates.map(d => d || '日程未定').join('・')}</span>}{!event.roles.length && !event.speaking_dates.length && <span className="text-slate-700">役割の割り当てはありません</span>}</div>
        </header>
        <div className="space-y-4 bg-white p-4">
          {event.alerts.length > 0 && <ul aria-label={`${event.name}のアラート`} className="space-y-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm">{event.alerts.map((alert, index) => <li key={index} className={`break-words ${alert.kind === 'OVERDUE' || alert.kind === 'ROLE_ABSENCE' ? 'font-bold text-red-800' : 'text-amber-950'}`}>● {alert.text}</li>)}</ul>}
          <details><summary className="min-h-11 cursor-pointer py-2 font-bold text-sky-950">出欠を確認・登録</summary><p className="mb-3 text-xs text-slate-700">選択すると保存します。イベントの出欠登録にも反映されます。</p><div className="grid gap-3 sm:grid-cols-2">{attendanceDateKeys(event.dates).map(date => <label key={date} className="block rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm font-medium">{date || '日程未定'}の出欠<select aria-label={`${event.name} ${date || '日程未定'}の出欠`} value={event.attendance.responses[date] ?? 'UNANSWERED'} disabled={busy || loading} onChange={e => attendance(event, date, e.target.value as RosterResponse)} className={field}>{Object.entries(ROSTER_RESPONSE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}{event.attendance.responses[date] === 'TENTATIVE' && <option value="TENTATIVE">調整中</option>}</select></label>)}</div></details>
          <details><summary className="min-h-11 cursor-pointer py-2 font-bold text-sky-950">担当タスク・進捗（{event.tasks.filter(t => t.status !== 'DONE').length}件未完了）</summary><p className="mb-3 text-xs text-slate-700">役割に連動したタスクです。同じ役割の担当者と進捗を共有し、選択すると保存します。</p>
            {!event.tasks.length && <p className="py-2 text-sm text-slate-700">連動するタスクはありません。運営画面の「タスク・期限管理」で各タスクに役割を設定できます。</p>}
            <ul className="space-y-3">{event.tasks.map(task => <li key={task.id} data-member-task={task.id} className={`space-y-2 rounded-xl border p-3 ${task.overdue ? 'border-red-400 bg-red-50' : 'border-slate-300 bg-slate-50'}`}><h4 className="break-words font-bold">{task.important && '【重要】'}{task.title}</h4><p className="break-words text-sm">{EVENT_ROLES[task.role_link.role!]}{task.role_link.date !== null && `（${task.role_link.date || '日程未定'}）`}・期限：{task.due_date ?? '未設定'}{task.overdue && <strong className="ml-2 text-red-800">期限超過</strong>}</p>
              {task.description && <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{task.description}</p>}<label className="block text-sm font-medium">進捗<select aria-label={`${event.name} ${task.title}の進捗`} value={task.status} disabled={busy || loading} onChange={e => taskStatus(event, task, e.target.value as TaskStatus)} className={field}>{Object.entries(TASK_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </li>)}</ul>
          </details>
        </div>
      </article>)}</div>
      {!events.length && <p className="rounded-xl border border-slate-300 bg-white p-6 text-center">表示するイベントはありません。</p>}
    </>}
    {!loading && !valid && !error && <p className="rounded-xl border border-slate-300 bg-white p-6">上の名簿から自分の名前を選択してください。</p>}
  </div>;
}
