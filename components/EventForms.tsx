'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { EVENT_TYPES, TASK_PHASES, TASK_STATUSES } from '@/types/event';
import type { EventDetail, EventTask, EventType, Member, SchedulePreview, TaskTemplate } from '@/types/event';

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900';
const buttonClass = 'rounded-lg bg-sky-800 px-4 py-2 font-bold text-white disabled:opacity-50';
const panelClass = 'rounded-xl border border-slate-200 bg-white p-5';
const datetime = (value: FormDataEntryValue | null) => value ? new Date(`${value}+09:00`).toISOString() : null;
const nullableNumber = (value: FormDataEntryValue | null) => value === '' || value === null ? null : Number(value);
async function send(path: string, body: object, method = 'POST') {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '処理できませんでした');
  return data;
}
function useMutation() {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function run(action: () => Promise<void>) {
    setError(''); setBusy(true);
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : '通信に失敗しました'); }
    finally { setBusy(false); }
  }
  return { error, busy, run };
}
function Feedback({ error }: { error: string }) { return error ? <p role="alert" className="text-red-700 text-sm mt-3">{error}</p> : null; }

export function EventForm({ members, templates }: { members: Member[]; templates: TaskTemplate[] }) {
  const router = useRouter(), mutation = useMutation();
  const [type, setType] = useState<EventType>('BASIC_COURSE');
  const [sessions, setSessions] = useState([1]);
  const count = templates.filter(row => row.active && row.family === (type === 'BASIC_COURSE' ? 'BASIC_COURSE' : 'LECTURE_SEMINAR')).length;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void mutation.run(async () => {
      const created = await send('/api/events', {
        type, title: data.get('title'), overview: data.get('overview'), venue: data.get('venue'), lecturer: data.get('lecturer'),
        owner_id: Number(data.get('owner_id')), capacity: nullableNumber(data.get('capacity')), fee: nullableNumber(data.get('fee')),
        application_deadline: datetime(data.get('application_deadline')),
        sessions: sessions.map(id => ({ starts_at: datetime(data.get(`start-${id}`)), ends_at: datetime(data.get(`end-${id}`)) })),
      });
      router.push(`/events/${created.id}`); router.refresh();
    });
  }
  return <form onSubmit={submit} className={`${panelClass} space-y-5`}>
    <label className="block">イベント種別<select className={inputClass} value={type} onChange={e => setType(e.target.value as EventType)}>{Object.entries(EVENT_TYPES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    <p className="text-sm text-slate-600">登録済みの標準タスク {count} 件を自動生成します。期限は最初の開催日（日本時間）が基準です。</p>
    {!count && <p className="text-sm text-amber-800">作成前に<Link className="underline" href="/task-templates">標準タスクを登録</Link>してください。項目や日数は研究会の運用に合わせて入力します。</p>}
    <label className="block">名称<input name="title" required maxLength={200} className={inputClass} /></label>
    <label className="block">概要<textarea name="overview" maxLength={2000} className={inputClass} /></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label>会場<input name="venue" maxLength={2000} className={inputClass} /></label>
      <label>講師<input name="lecturer" maxLength={2000} className={inputClass} /></label>
      <label>責任者<select name="owner_id" required className={inputClass}><option value="">選択してください</option>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
      <label>定員（未定なら空欄）<input name="capacity" type="number" min={1} max={100000} className={inputClass} /></label>
      <label>参加費・円（未定なら空欄）<input name="fee" type="number" min={0} max={100000000} className={inputClass} /></label>
      <label>申込締切（日本時間）<input name="application_deadline" type="datetime-local" className={inputClass} /></label>
    </div>
    <fieldset className="space-y-4"><legend className="font-bold mb-2">開催回・日時（日本時間）</legend>
      {sessions.map((id, index) => <div key={id} className="rounded-lg bg-slate-50 p-4 space-y-3">
        <p className="font-medium">第{index + 1}回</p>
        <div className="grid gap-4 sm:grid-cols-2"><label>開始<input type="datetime-local" name={`start-${id}`} required className={inputClass} /></label><label>終了<input type="datetime-local" name={`end-${id}`} required className={inputClass} /></label></div>
        {sessions.length > 1 && <button type="button" className="text-sm text-red-700 underline" onClick={() => setSessions(sessions.filter(value => value !== id))}>この回を削除</button>}
      </div>)}
      <button type="button" disabled={sessions.length >= 50} className="text-sky-800 underline" onClick={() => setSessions([...sessions, Math.max(...sessions) + 1])}>＋ 開催回を追加</button>
    </fieldset>
    <Feedback error={mutation.error} />
    <button disabled={mutation.busy || !count} className={buttonClass}>イベントを作成してタスクを生成</button>
  </form>;
}

export function TemplateEditor({ templates }: { templates: TaskTemplate[] }) {
  const router = useRouter(), mutation = useMutation();
  const [selected, setSelected] = useState<TaskTemplate | null>(null);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void mutation.run(async () => {
      await send(`/api/task-templates${selected ? `/${selected.id}` : ''}`, {
        family: data.get('family'), title: data.get('title'), relative_days: Number(data.get('relative_days')), phase: data.get('phase'),
        important: data.has('important'), active: data.has('active'), ...(selected ? { version: selected.version } : {}),
      }, selected ? 'PATCH' : 'POST');
      setSelected(null); router.refresh();
    });
  }
  return <div className="grid gap-6 lg:grid-cols-2">
    <div className="space-y-3">{templates.length === 0 && <p>標準タスクはまだ登録されていません。</p>}{templates.map(row => <button key={`${row.id}-${row.version}`} type="button" className={`${panelClass} text-left block w-full ${selected?.id === row.id ? 'ring-2 ring-sky-600' : ''}`} onClick={() => setSelected(row)}>
      <span className="block text-sm text-slate-600">{row.family === 'BASIC_COURSE' ? 'ベーシック' : '講演会・セミナー共通'} · {TASK_PHASES[row.phase]}</span>
      <span className="block font-bold mt-1">{row.title}</span>
      <span className="text-sm">開催初日から {row.relative_days} 日 · {row.important ? '重要' : '通常'} · {row.active ? '使用中' : '停止中'}</span>
    </button>)}</div>
    <form key={selected ? `${selected.id}-${selected.version}` : `new-${templates.length}`} onSubmit={submit} className={`${panelClass} space-y-4 self-start`}>
      <h2 className="font-bold">{selected ? '標準タスクを編集' : '標準タスクを追加'}</h2>
      <label className="block">対象<select name="family" defaultValue={selected?.family ?? 'BASIC_COURSE'} className={inputClass}><option value="BASIC_COURSE">ベーシックコース</option><option value="LECTURE_SEMINAR">講演会・セミナー共通</option></select></label>
      <label className="block">タスク名<input name="title" required maxLength={200} defaultValue={selected?.title} className={inputClass} /></label>
      <label className="block">開催初日からの日数（30日前なら -30、当日なら 0）<input name="relative_days" required type="number" min={-3650} max={3650} defaultValue={selected?.relative_days ?? 0} className={inputClass} /></label>
      <label className="block">区分<select name="phase" defaultValue={selected?.phase ?? 'PREPARATION'} className={inputClass}>{Object.entries(TASK_PHASES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="block"><input type="checkbox" name="important" defaultChecked={selected?.important ?? false} /> 重要タスク</label>
      <label className="block"><input type="checkbox" name="active" defaultChecked={selected?.active ?? true} /> 新しいイベントで使用する</label>
      <p className="text-sm text-slate-600">変更は今後作成するイベントに適用されます。作成済みのタスクは書き換えません。</p>
      <Feedback error={mutation.error} /><button className={buttonClass} disabled={mutation.busy}>保存</button>
      {selected && <button type="button" className="ml-4 underline" onClick={() => setSelected(null)}>新規追加へ</button>}
    </form>
  </div>;
}

export function TaskEditor({ task, members }: { task: EventTask; members: Member[] }) {
  const mutation = useMutation(), router = useRouter();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    void mutation.run(async () => {
      await send(`/api/tasks/${task.id}`, { version: task.version, status: data.get('status'), assignee_id: nullableNumber(data.get('assignee_id')),
        collaborator_ids: data.getAll('collaborators').map(Number), important: data.has('important'), due_on: data.get('due_on') }, 'PATCH');
      router.refresh();
    });
  }
  return <form id={`task-${task.id}`} onSubmit={submit} className={`${panelClass} space-y-4`}>
    <h3 className="font-bold text-lg">{task.title}</h3>
    <p className="text-xs text-slate-600">{TASK_PHASES[task.phase]} · {task.due_mode === 'MANUAL' ? '個別指定の期限' : '開催日からの期限'}</p>
    <div className="grid sm:grid-cols-3 gap-4">
      <label>状態<select name="status" defaultValue={task.status} className={inputClass}>{Object.entries(TASK_STATUSES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label>主担当<select name="assignee_id" defaultValue={task.assignee_id ?? ''} className={inputClass}><option value="">未割当</option>{members.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label>期限<input type="date" name="due_on" defaultValue={task.due_on} required className={inputClass} /></label>
    </div>
    <fieldset><legend className="text-sm mb-2">協力者（複数選択・主担当以外）</legend><div className="flex flex-wrap gap-4">{members.map(row => <label key={row.id} className="text-sm"><input type="checkbox" name="collaborators" value={row.id} defaultChecked={task.collaborator_ids.includes(row.id)} /> {row.name}</label>)}</div></fieldset>
    <label className="block"><input type="checkbox" name="important" defaultChecked={task.important} /> 重要タスク</label>
    <Feedback error={mutation.error} /><div className="flex gap-4"><button className={buttonClass} disabled={mutation.busy}>タスクを保存</button><button type="button" className="underline text-sm" onClick={() => router.refresh()}>最新情報を再読み込み</button></div>
  </form>;
}

export function AddTask({ eventId }: { eventId: number }) {
  const router = useRouter(), mutation = useMutation();
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, data = new FormData(form);
    void mutation.run(async () => {
      await send(`/api/events/${eventId}/tasks`, { title: data.get('title'), due_on: data.get('due_on'), phase: data.get('phase'), important: data.has('important') });
      form.reset(); router.refresh();
    });
  }
  return <form onSubmit={submit} className={`${panelClass} space-y-4`}><h3 className="font-bold">イベント固有のタスクを追加</h3>
    <label className="block">タスク名<input name="title" maxLength={200} required className={inputClass} /></label>
    <div className="grid sm:grid-cols-2 gap-4"><label>期限<input type="date" name="due_on" required className={inputClass} /></label><label>区分<select name="phase" className={inputClass}>{Object.entries(TASK_PHASES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label></div>
    <label className="block"><input type="checkbox" name="important" /> 重要タスク</label><Feedback error={mutation.error} /><button disabled={mutation.busy} className={buttonClass}>追加</button>
  </form>;
}

export function OwnerEditor({ event, members }: { event: EventDetail; members: Member[] }) {
  const router = useRouter(), mutation = useMutation();
  return <form onSubmit={e => {
    e.preventDefault(); const data = new FormData(e.currentTarget);
    void mutation.run(async () => { await send(`/api/events/${event.id}`, { owner_id: Number(data.get('owner_id')), version: event.version }, 'PATCH'); router.refresh(); });
  }} className="space-y-3"><label className="block">イベント責任者<select name="owner_id" defaultValue={event.owner_id} className={inputClass}>{members.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label><Feedback error={mutation.error} /><button disabled={mutation.busy} className={buttonClass}>責任者を保存</button></form>;
}

export function SchedulePreviewForm({ event }: { event: EventDetail }) {
  const mutation = useMutation(); const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const firstDate = new Date(Date.parse(event.starts_at) + 9 * 3600000).toISOString().slice(0, 10);
  return <section className={`${panelClass} space-y-4`}>
    <h2 className="font-bold">日程変更の差分確認（保存なし）</h2>
    <p className="text-sm text-slate-600">すべての開催回を同じ日数移動した場合の案を表示します。完了済み・個別期限の扱いは未決定のため、この画面から日程や期限は変更されません。</p>
    <form onSubmit={e => {
      e.preventDefault(); const date = String(new FormData(e.currentTarget).get('new_date')); setPreview(null);
      void mutation.run(async () => {
        const delta = Date.parse(date) - Date.parse(firstDate);
        const sessions = event.sessions.map(row => ({ starts_at: new Date(Date.parse(row.starts_at) + delta).toISOString(), ends_at: new Date(Date.parse(row.ends_at) + delta).toISOString() }));
        setPreview(await send(`/api/events/${event.id}/schedule-preview`, { sessions }));
      });
    }} className="space-y-3"><label className="block">変更案の初回開催日<input name="new_date" type="date" required defaultValue={firstDate} className={inputClass} /></label><button disabled={mutation.busy} className={buttonClass}>差分を確認</button></form>
    <Feedback error={mutation.error} />
    {preview && <ul className="space-y-2">{preview.changes.map(row => <li key={row.id} className="rounded-lg bg-slate-50 p-3 text-sm"><span className="font-bold">{row.title}</span><p>{row.before} → {row.proposed}</p>{row.needs_decision && <p className="text-amber-800">完了済み／個別期限：扱いの決定が必要</p>}</li>)}</ul>}
  </section>;
}
