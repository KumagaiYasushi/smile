'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import SocietyMemberPicker from '@/components/SocietyMemberPicker';
import { apiJson } from '@/lib/client-api';
import { STAFF_ROLE_LABELS, STAFF_SELECTABLE_ROLE_LABELS, STAFF_RESPONSE_LABELS, attendanceDateKeys, attendanceDateLabel } from '@/types/staff-attendance';
import type { StaffPerson, StaffInput, StaffRole, StaffResponse, StaffAttendance, StaffHistory } from '@/types/staff-attendance';

const inputClass = 'mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const buttonClass = 'rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50';
type Result = StaffAttendance & { history: StaffHistory[] };

function AttendanceEditor({ initial, dates, onSave, onCancel }: {
  initial: StaffPerson | null; dates: string[]; onSave: (input: StaffInput) => Promise<void>; onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState<StaffRole | ''>(initial ? Object.hasOwn(STAFF_SELECTABLE_ROLE_LABELS, initial.role) ? initial.role : '' : 'SOCIETY_SUPPORT');
  const [responses, setResponses] = useState<Record<string, StaffResponse>>(() => Object.fromEntries(
    attendanceDateKeys(dates).map(date => [date, initial?.responses[date] ?? 'UNANSWERED'])
  ));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try { await onSave({ name, role: role as StaffRole, responses, schedule: dates }); }
    catch (error) { setError(error instanceof Error ? error.message : '保存できませんでした'); }
    finally { setSaving(false); }
  }
  return <form aria-label="出欠予定の編集" onSubmit={submit} className="space-y-4 rounded-2xl border border-sky-200 bg-white p-5">
    <h2 className="font-bold">{initial ? '出欠予定を編集' : '講師・サポートメンバーを追加'}</h2>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {role==='SOCIETY_LECTURER'||role==='SOCIETY_SUPPORT'?<SocietyMemberPicker role={role} label="氏名（必須）" required value={name} onChange={setName}/>:<label className="block text-sm font-medium">氏名（必須）
      <input autoFocus required maxLength={200} value={name} onChange={e => setName(e.target.value)} className={inputClass} />
    </label>}
    <label className="block text-sm font-medium">役割
      <select aria-label="役割" required value={role} onChange={e => {setRole(e.target.value as StaffRole);setName('');}} className={inputClass}>
        <option value="" disabled>区分を選択してください</option>
        {Object.entries(STAFF_SELECTABLE_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </label>
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-bold">開催日ごとの出欠予定</legend>
      {attendanceDateKeys(dates).map(date => <label key={date} className="block text-sm">{attendanceDateLabel(date)}
        <select aria-label={`${attendanceDateLabel(date)}の出欠予定`} value={responses[date]} onChange={e => setResponses({ ...responses, [date]: e.target.value as StaffResponse })} className={inputClass}>
          {Object.entries(STAFF_RESPONSE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>)}
    </fieldset>
    <div className="flex flex-wrap gap-3">
      <button disabled={saving} className="rounded-lg bg-sky-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? '保存中…' : '保存する'}</button>
      <button type="button" disabled={saving} onClick={onCancel} className={buttonClass}>キャンセル</button>
    </div>
  </form>;
}

export default function StaffAttendancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const path = `/api/seminars/${id}/staff-attendance`;
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<StaffPerson | null | undefined>(undefined);
  const [filter, setFilter] = useState<StaffRole | 'ALL'>('ALL');
  const load = useCallback(async () => { const result: Result = await apiJson(path); setData(result); }, [path]);
  useEffect(() => {
    const controller = new AbortController();
    apiJson(path, { signal: controller.signal }).then(setData)
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [path]);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : '処理に失敗しました'); }
    finally { setBusy(false); }
  }
  const keys = attendanceDateKeys(data?.dates ?? []);
  const visible = data?.people.filter(person => filter === 'ALL' || person.role === filter) ?? [];

  return <div className="space-y-5">
    <Link href={`/seminars/${id}`} className="text-sm text-sky-800 underline">← イベント詳細に戻る</Link>
    <div><h1 className="text-2xl font-bold">講師・サポートの出欠予定</h1>
      {data && <p className="mt-1 break-words text-slate-600">{data.event_name}</p>}
      <p className="mt-2 text-sm text-slate-600">各開催日の出欠予定を事前に登録します。新しい開催日は未回答から確認してください。</p>
    </div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    <div className="flex flex-wrap gap-2">
      <button disabled={busy || editor !== undefined} onClick={() => { setMessage(''); setEditor(null); }} className={buttonClass}>＋ メンバーを追加</button>
      <button disabled={busy || !data || editor !== undefined} onClick={() => action(async () => {
        const result = await apiJson(`${path}/import`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ schedule: data!.dates }) });
        await load(); setMessage(`${result.added}名を取り込みました。登録済みの出欠予定は保持しています。`);
      })} className={buttonClass}>登録済みの講師・スタッフ名を取り込む</button>
      <button disabled={busy || editor !== undefined} onClick={() => action(load)} className={buttonClass}>最新情報を取得</button>
    </div>
    {!data && !error && <p>読み込み中…</p>}
    {data && <>
      <p className="text-xs text-slate-500">取り込みはイベント基本情報の講師名とサポートメンバー名を使用します。氏名・役割が同じ登録は追加しません。</p>
      {editor !== undefined && <AttendanceEditor key={editor?.id ?? 'new'} initial={editor} dates={data.dates} onCancel={() => setEditor(undefined)} onSave={async input => {
        setBusy(true);
        try {
          const result = await apiJson(editor ? `${path}/${editor.id}` : path, {
            method: editor ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...input, ...(editor ? { version: editor.version } : {}) }),
          });
          // Reflect the successful write even if the subsequent history fetch fails.
          setData(current => current ? { ...current, people: [...current.people.filter(person => person.id !== result.person.id), result.person] } : current);
          setEditor(undefined); setMessage('保存しました'); setError('');
          try { await load(); } catch { setError('保存済みですが最新情報を取得できませんでした。「最新情報を取得」で再確認してください'); }
        } finally { setBusy(false); }
      }} />}
      <label className="block max-w-sm text-sm font-medium">役割で絞り込み
        <select aria-label="役割で絞り込み" value={filter} onChange={e => setFilter(e.target.value as StaffRole | 'ALL')} className={inputClass}>
          <option value="ALL">すべて</option>
          {Object.entries(STAFF_ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <section aria-label="出欠予定の集計" className="grid gap-3 sm:grid-cols-2">
        {keys.map(date => <div key={date} className="rounded-xl border bg-white p-4 text-sm">
          <h2 className="font-bold">{attendanceDateLabel(date)}</h2>
          <p className="mt-2 leading-6">{Object.entries(STAFF_RESPONSE_LABELS).map(([status, label]) => `${label} ${visible.filter(person => (person.responses[date] ?? 'UNANSWERED') === status).length}名`).join(' ／ ')}</p>
        </div>)}
      </section>
      <div className="space-y-4">{visible.map(person => <article key={person.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0"><h2 className="break-words font-bold">{person.name}</h2><p className="text-sm text-slate-500">{STAFF_ROLE_LABELS[person.role]}</p></div>
          <div className="flex gap-2">
            <button disabled={busy || editor !== undefined} onClick={() => setEditor(person)} className={buttonClass}>編集</button>
            <button disabled={busy || editor !== undefined} onClick={() => {
              if (!confirm(`「${person.name}」の出欠予定を削除しますか？`)) return;
              action(async () => {
                await apiJson(`${path}/${person.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: person.version }) });
                setData(current => current ? { ...current, people: current.people.filter(item => item.id !== person.id) } : current);
                setMessage('削除しました'); await load();
              });
            }} className={buttonClass}>削除</button>
          </div>
        </div>
        <dl className="mt-4 space-y-2 text-sm">{keys.map(date => <div key={date} className="flex flex-wrap gap-x-4 gap-y-1">
          <dt>{attendanceDateLabel(date)}</dt><dd>{STAFF_RESPONSE_LABELS[person.responses[date] ?? 'UNANSWERED']}</dd>
        </div>)}</dl>
        {Object.keys(person.responses).some(date => !keys.includes(date)) && <details className="mt-3 text-sm text-slate-500">
          <summary className="cursor-pointer">旧日程の登録内容</summary>
          <ul className="mt-2 space-y-1">{Object.entries(person.responses).filter(([date]) => !keys.includes(date)).map(([date, status]) => <li key={date}>{attendanceDateLabel(date)}：{STAFF_RESPONSE_LABELS[status]}</li>)}</ul>
        </details>}
      </article>)}</div>
      {visible.length === 0 && <p className="py-6 text-center text-slate-500">{data.people.length ? 'この役割の登録はありません' : '講師・サポートメンバーを追加するか、登録済みの氏名を取り込んでください'}</p>}
      <details className="rounded-xl border bg-white p-4 text-sm">
        <summary className="cursor-pointer font-bold">変更履歴（直近100件）</summary>
        <ol className="mt-4 space-y-3">{data.history.map(item => <li key={item.id} className="rounded-lg bg-slate-50 p-3">
          <p>{new Date(item.occurred_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}（日本時間）・{item.action === 'created' ? '登録' : item.action === 'updated' ? '更新' : '削除'}</p>
          <p>対象 #{item.person_id}・操作アカウント #{item.actor_id}</p>
          {item.after && <p>{STAFF_ROLE_LABELS[item.after.role]}：{Object.entries(item.after.responses).map(([date, status]) => `${attendanceDateLabel(date)} ${STAFF_RESPONSE_LABELS[status]}`).join(' ／ ')}</p>}
        </li>)}</ol>
        {data.history.length === 0 && <p className="mt-3">履歴はありません</p>}
      </details>
    </>}
  </div>;
}
