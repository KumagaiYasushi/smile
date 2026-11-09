'use client';
import { useState } from 'react';
import { apiJson } from '@/lib/client-api';
import { EVENT_ROLES, EVENT_DAY_ROLES } from '@/types/event-roles';
import type { TaskRoleLink } from '@/types/member-page';
import type { EventRoleKey } from '@/types/event-roles';

export default function TaskRoleLinkPanel({ eventId, taskId, disabled }: { eventId: string; taskId: number; disabled: boolean }) {
  const [link, setLink] = useState<TaskRoleLink | null>(null), [dates, setDates] = useState<string[]>([]);
  const [role, setRole] = useState(''), [date, setDate] = useState('*');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const endpoint = `/api/seminars/${eventId}/tasks/${taskId}/role-link`;
  async function load() {
    setBusy(true); setError(''); setNotice('');
    try { const data = await apiJson(endpoint); setLink(data.link); setDates(data.dates); setRole(data.link.role ?? ''); setDate(data.link.date ?? '*'); }
    catch (e) { setError(e instanceof Error ? e.message : '取得できませんでした'); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!link) return; setBusy(true); setError(''); setNotice('');
    try {
      const data = await apiJson(endpoint, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: role || null, date: role && Object.hasOwn(EVENT_DAY_ROLES, role) && date !== '*' ? date : null, version: link.version }) });
      setLink(data.link); setNotice('役割との連動を保存しました');
    } catch (e) { setError(e instanceof Error ? e.message : '保存できませんでした'); }
    finally { setBusy(false); }
  }
  const field = 'mt-1 block min-h-11 w-full rounded-lg border border-slate-400 bg-white p-2 text-base';
  return <details className="mt-4 rounded-lg border border-sky-300 bg-sky-50 p-3" onToggle={e => { if (e.currentTarget.open && !link && !busy) void load(); }}>
    <summary className="cursor-pointer font-bold text-sky-950">役割と連動するタスクに設定</summary>
    <div className="mt-3 space-y-3 text-sm text-slate-800">
      <p>選んだ役割の担当者の個人ページに表示します。複数名が担当する場合、タスクの進捗は共有されます。</p>
      {error && <p role="alert" className="text-red-800">{error}</p>}{notice && <p role="status" className="text-green-900">{notice}</p>}
      {link && <fieldset disabled={disabled || busy} className="space-y-3"><label className="block">連動する役割<select aria-label="連動する役割" className={field} value={role} onChange={e => { setRole(e.target.value as EventRoleKey); setDate('*'); setNotice(''); }}><option value="">連動なし</option>{Object.entries(EVENT_ROLES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {Object.hasOwn(EVENT_DAY_ROLES, role) && <label className="block">対象の開催日<select aria-label="対象の開催日" className={field} value={date} onChange={e => { setDate(e.target.value); setNotice(''); }}><option value="*">担当するすべての開催日</option>{(dates.length ? dates : ['']).map(d => <option key={d} value={d}>{d || '日程未定'}</option>)}{date !== '*' && !(dates.length ? dates : ['']).includes(date) && <option value={date}>{date}（開催日から削除済み）</option>}</select></label>}
        <button type="button" onClick={save} className="min-h-11 rounded-lg bg-sky-900 px-4 py-2 font-bold text-white disabled:opacity-50">連動設定を保存</button>
      </fieldset>}
      <button type="button" disabled={busy || disabled} onClick={load} className="min-h-11 text-sky-900 underline disabled:opacity-50">{busy ? '読み込み・保存中…' : '最新の連動設定を取得'}</button>
    </div>
  </details>;
}
