'use client';

import { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { TASK_STATUS_LABELS, isTaskOverdue } from '@/types/task';
import type { EventTask, TaskInput, TaskMember, TaskStatus, TaskHistory } from '@/types/task';
import TemplateGenerationPanel from '@/components/TemplateGenerationPanel';

const inputClass = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const fieldNames: Record<string, string> = { title: 'タスク名', description: '説明', due_date: '期限', status: '状態', important: '重要設定', assignee_id: '主担当者', collaborator_ids: '協力者' };

async function fetchJson(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  if (response.status === 401) { window.location.assign('/login'); throw new Error('ログインが必要です'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '処理に失敗しました');
  return result;
}

function TaskEditor({ initial, members, onSave, onCancel }: {
  initial: EventTask | null; members: TaskMember[]; onSave: (input: TaskInput) => Promise<void>; onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [dueDate, setDueDate] = useState(initial?.due_date ?? '');
  const [status, setStatus] = useState<TaskStatus>(initial?.status ?? 'NOT_STARTED');
  const [important, setImportant] = useState(initial?.important ?? false);
  const [assignee, setAssignee] = useState(initial?.assignee_id?.toString() ?? '');
  const [collaborators, setCollaborators] = useState(initial?.collaborator_ids ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  const missingMembers = collaborators.filter((id) => !members.some((member) => member.id === id));

  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await onSave({ title, description, due_date: dueDate || null, status, important,
        assignee_id: assignee ? Number(assignee) : null, collaborator_ids: collaborators });
    } catch (error) { setError(error instanceof Error ? error.message : '保存できませんでした'); }
    finally { setSaving(false); }
  }

  return <form onSubmit={submit} className="mb-6 space-y-4 rounded-2xl border border-sky-200 bg-white p-5" aria-label={initial ? 'タスク編集' : 'タスク追加'}>
    <h2 className="text-lg font-bold">{initial ? 'タスクを編集' : 'タスクを追加'}</h2>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <label className="block text-sm font-medium">タスク名（必須）
      <input ref={titleRef} required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
    </label>
    <label className="block text-sm font-medium">説明
      <textarea aria-label="説明" maxLength={2000} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />
    </label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium">期限
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
      </label>
      <label className="block text-sm font-medium">状態
        <select aria-label="状態" value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={inputClass}>
          {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
    </div>
    <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} />重要タスク</label>
    <label className="block text-sm font-medium">主担当者
      <select aria-label="主担当者" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputClass}>
        <option value="">未割当</option>
        {members.map((member) => <option key={member.id} value={member.id}>{member.email}</option>)}
        {assignee && !members.some((member) => String(member.id) === assignee) && <option value={assignee}>利用停止アカウント #{assignee}</option>}
      </select>
    </label>
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-medium">協力者（複数選択可）</legend>
      {[...members, ...missingMembers.map((id) => ({ id, email: `利用停止アカウント #${id}` }))].map((member) => <label key={member.id} className="flex items-center gap-2 break-all text-sm">
        <input type="checkbox" checked={collaborators.includes(member.id)} onChange={(e) => setCollaborators(e.target.checked ? [...collaborators, member.id] : collaborators.filter((id) => id !== member.id))} />{member.email}
      </label>)}
    </fieldset>
    <div className="flex flex-wrap gap-3">
      <button disabled={saving} className="rounded-lg bg-sky-800 px-5 py-2 font-bold text-white disabled:opacity-50">{saving ? '保存中…' : '保存する'}</button>
      <button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border px-5 py-2">キャンセル</button>
    </div>
  </form>;
}

function HistoryPanel({ seminarId, taskId, members }: { seminarId: string; taskId: number; members: TaskMember[] }) {
  const [items, setItems] = useState<TaskHistory[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetchJson(`/api/seminars/${seminarId}/tasks/${taskId}`, { signal: controller.signal })
      .then((result) => setItems(result.history)).catch((error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [seminarId, taskId]);
  return <div className="mt-4 border-t pt-4 text-sm" aria-label="タスクの変更履歴">
    <h3 className="mb-3 font-bold">変更履歴</h3>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!items && !error && <p>読み込み中…</p>}
    <ol className="space-y-3">{items?.map((item) => <li key={item.id} className="rounded-lg bg-slate-50 p-3 space-y-1">
      <p>{item.action === 'created' ? '作成' : '更新'}・{new Date(item.occurred_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}（日本時間）</p>
      <p className="break-all text-slate-500">操作：{members.find((member) => member.id === item.actor_id)?.email ?? `アカウント #${item.actor_id}`}</p>
      {item.action === 'updated' && <p>変更項目：{item.changed_fields.map((field) => fieldNames[field] ?? field).join('、')}</p>}
      {item.before && item.after && <>
        {item.before.due_date !== item.after.due_date && <p>期限：{item.before.due_date ?? '未設定'} → {item.after.due_date ?? '未設定'}</p>}
        {item.before.status !== item.after.status && <p>状態：{TASK_STATUS_LABELS[item.before.status]} → {TASK_STATUS_LABELS[item.after.status]}</p>}
        {item.before.important !== item.after.important && <p>重要設定：{item.before.important ? '重要' : '通常'} → {item.after.important ? '重要' : '通常'}</p>}
        {item.before.assignee_id !== item.after.assignee_id && <p>主担当者：{item.before.assignee_id == null ? '未割当' : members.find((member) => member.id === item.before?.assignee_id)?.email ?? `#${item.before.assignee_id}`} → {item.after.assignee_id == null ? '未割当' : members.find((member) => member.id === item.after?.assignee_id)?.email ?? `#${item.after.assignee_id}`}</p>}
        {JSON.stringify(item.before.collaborator_ids) !== JSON.stringify(item.after.collaborator_ids) && <p className="break-all">協力者：{item.before.collaborator_ids.map((id) => members.find((member) => member.id === id)?.email ?? `#${id}`).join('、') || 'なし'} → {item.after.collaborator_ids.map((id) => members.find((member) => member.id === id)?.email ?? `#${id}`).join('、') || 'なし'}</p>}
      </>}
    </li>)}</ol>
  </div>;
}

export default function TasksPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tasks, setTasks] = useState<EventTask[]>([]);
  const [members, setMembers] = useState<TaskMember[]>([]);
  const [seminarName, setSeminarName] = useState('');
  const [seminarDates, setSeminarDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<EventTask | null | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [focusFilter, setFocusFilter] = useState('ALL');
  const [historyId, setHistoryId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const endpoint = `/api/seminars/${id}/tasks`;

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([fetchJson(`/api/seminars/${id}/tasks`, { signal: controller.signal }), fetchJson('/api/members', { signal: controller.signal }), fetchJson(`/api/seminars/${id}`, { signal: controller.signal })])
      .then(([data, directory, seminar]) => { setTasks(data.tasks); setMembers(directory.members); setSeminarName(seminar.name); setSeminarDates(seminar.dates); setLoading(false); })
      .catch((error) => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [id]);

  async function refresh() {
    const [data, directory, seminar] = await Promise.all([fetchJson(endpoint), fetchJson('/api/members'), fetchJson(`/api/seminars/${id}`)]);
    setTasks(data.tasks); setMembers(directory.members); setSeminarName(seminar.name); setSeminarDates(seminar.dates);
  }
  function edit(task: EventTask | null) { setEditing(task); setNotice(''); setTimeout(() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0); }
  async function save(input: TaskInput) {
    const task = editing;
    await fetchJson(task ? `${endpoint}/${task.id}` : endpoint, { method: task ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(task ? { ...input, version: task.version } : input) });
    setEditing(undefined); setHistoryId(null); setNotice('タスクを保存しました');
    try { await refresh(); } catch { setError('保存しましたが一覧を更新できませんでした。「最新の内容を取得」を押してください。'); }
  }
  async function changeStatus(task: EventTask, status: TaskStatus) {
    setBusy(true); setError(''); setNotice('');
    try {
      await fetchJson(`${endpoint}/${task.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, version: task.version }) });
      setHistoryId(null); await refresh(); setNotice('状態を更新しました');
    } catch (error) { setError(error instanceof Error ? error.message : '更新できませんでした'); }
    finally { setBusy(false); }
  }
  async function remove(task: EventTask) {
    if (!confirm(`「${task.title}」を削除しますか？`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await fetchJson(`${endpoint}/${task.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: task.version }) });
      if (editing?.id === task.id) setEditing(undefined);
      await refresh(); setNotice('タスクを削除しました');
    } catch (error) { setError(error instanceof Error ? error.message : '削除できませんでした'); }
    finally { setBusy(false); }
  }
  async function reload() {
    if (editing !== undefined && !confirm('編集中の入力を破棄して、最新の内容を取得しますか？')) return;
    setBusy(true); setError('');
    try { await refresh(); setEditing(undefined); setHistoryId(null); }
    catch (error) { setError(error instanceof Error ? error.message : '取得できませんでした'); }
    finally { setBusy(false); }
  }

  if (loading) return <p className="py-12 text-center text-slate-500">読み込み中…</p>;
  const visible = tasks.filter((task) => (statusFilter === 'ALL' || task.status === statusFilter)
    && (focusFilter === 'ALL' || (focusFilter === 'IMPORTANT' && task.important) || (focusFilter === 'OVERDUE' && isTaskOverdue(task)) || (focusFilter === 'UNASSIGNED' && task.assignee_id === null)));
  return <div className="space-y-5">
    <Link href={`/seminars/${id}`} className="text-sm text-sky-700">← イベント詳細へ</Link>
    <Link href={`/seminars/${id}/reschedule`} className="ml-4 inline-block text-sm text-sky-700 underline">開催日・期限変更</Link>
    <div><h1 className="text-2xl font-bold text-slate-800">タスク・期限管理</h1><p className="mt-1 text-slate-500">{seminarName}</p></div>
    <TemplateGenerationPanel key={JSON.stringify(seminarDates)} seminarId={id} dates={seminarDates} disabled={busy || editing !== undefined} onApplied={refresh} />
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{notice}</p>}
    <div className="flex flex-wrap gap-3">
      <button disabled={busy || editing !== undefined || !seminarName} onClick={() => edit(null)} className="rounded-lg bg-sky-800 px-4 py-2 font-bold text-white disabled:opacity-50">＋ タスクを追加</button>
      <button disabled={busy} onClick={reload} className="rounded-lg border bg-white px-4 py-2 text-sm">最新の内容を取得</button>
    </div>
    <div ref={editorRef}>{editing !== undefined && <TaskEditor key={editing?.id ?? 'new'} initial={editing} members={members} onSave={save} onCancel={() => setEditing(undefined)} />}</div>
    <div className="grid grid-cols-2 gap-3 sm:max-w-xl">
      <label className="text-sm">状態で絞り込み<select aria-label="状態で絞り込み" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputClass}>
        <option value="ALL">すべての状態</option>{Object.entries(TASK_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label className="text-sm">表示対象<select aria-label="表示対象" value={focusFilter} onChange={(e) => setFocusFilter(e.target.value)} className={inputClass}>
        <option value="ALL">すべて</option><option value="IMPORTANT">重要タスク</option><option value="OVERDUE">期限超過</option><option value="UNASSIGNED">主担当者が未割当</option>
      </select></label>
    </div>
    <p className="text-sm text-slate-500" aria-live="polite">{visible.length} / {tasks.length} 件・完了 {tasks.filter((task) => task.status === 'DONE').length} 件</p>
    {!visible.length && <p className="rounded-xl border bg-white p-8 text-center text-slate-500">{tasks.length ? '条件に一致するタスクはありません' : 'タスクはまだありません。「タスクを追加」から登録できます。'}</p>}
    <div className="grid items-start gap-4 lg:grid-cols-2">{visible.map((task) => <article key={task.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="mb-2 flex flex-wrap gap-2 text-xs">
        {task.important && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-900">重要</span>}
        {isTaskOverdue(task) && <span className="rounded-full bg-red-100 px-2 py-1 text-red-800">期限超過</span>}
        {task.assignee_id === null && <span className="rounded-full bg-slate-100 px-2 py-1">主担当未割当</span>}
      </div>
      <h2 className="break-words text-lg font-bold text-slate-800">{task.title}</h2>
      {task.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{task.description}</p>}
      <dl className="my-4 space-y-2 text-sm">
        <div><dt className="inline text-slate-500">期限：</dt><dd className="inline">{task.due_date ?? '未設定'}</dd></div>
        <div className="break-all"><dt className="inline text-slate-500">主担当者：</dt><dd className="inline">{task.assignee_id === null ? '未割当' : members.find((member) => member.id === task.assignee_id)?.email ?? `利用停止アカウント #${task.assignee_id}`}</dd></div>
        <div className="break-all"><dt className="inline text-slate-500">協力者：</dt><dd className="inline">{task.collaborator_ids.map((id) => members.find((member) => member.id === id)?.email ?? `利用停止アカウント #${id}`).join('、') || 'なし'}</dd></div>
      </dl>
      <label className="block text-sm">状態<select aria-label={`${task.title}の状態`} disabled={busy || editing !== undefined} value={task.status} onChange={(e) => changeStatus(task, e.target.value as TaskStatus)} className={inputClass}>
        {Object.entries(TASK_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <div className="mt-4 flex flex-wrap gap-4 text-sm">
        <button disabled={busy || editing !== undefined} onClick={() => edit(task)} className="text-sky-700 underline disabled:opacity-50">編集</button>
        <button onClick={() => setHistoryId(historyId === task.id ? null : task.id)} aria-expanded={historyId === task.id} className="text-sky-700 underline">{historyId === task.id ? '履歴を閉じる' : '変更履歴'}</button>
        <button disabled={busy} onClick={() => remove(task)} className="text-red-700 underline">削除</button>
      </div>
      {historyId === task.id && <HistoryPanel seminarId={id} taskId={task.id} members={members} />}
    </article>)}</div>
  </div>;
}
