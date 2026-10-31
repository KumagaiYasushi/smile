import { notFound } from 'next/navigation';
import { eventPageStore } from '@/lib/event-page';
import { EventError } from '@/lib/event-store';
import { EVENT_TYPES, TASK_STATUSES } from '@/types/event';
import { AddTask, OwnerEditor, SchedulePreviewForm, TaskEditor } from '@/components/EventForms';
import Link from 'next/link';

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) notFound();
  const store = await eventPageStore();
  let event;
  try { event = store.get(Number(id)); } catch (error) { if (error instanceof EventError && error.status === 404) notFound(); throw error; }
  const members = store.members(), history = store.history(event.id);
  const date = (value: string) => new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
  return <div className="space-y-6">
    <header><p className="text-sm text-sky-800">{EVENT_TYPES[event.type]}</p><h1 className="text-2xl font-bold mt-1">{event.title}</h1><p className="whitespace-pre-wrap mt-3 text-slate-700">{event.overview}</p></header>
    <Link href={`/events/${event.id}/registrations`} className="inline-block rounded-lg bg-sky-800 px-5 py-3 text-white font-bold">申込情報を管理</Link>
    <section className="grid gap-6 md:grid-cols-2 rounded-xl border border-slate-200 bg-white p-5">
      <div className="space-y-2"><h2 className="font-bold">開催情報（日本時間）</h2>{event.sessions.map((session, index) => <p key={index}>第{index + 1}回：{date(session.starts_at)} 〜 {date(session.ends_at)}</p>)}
        <p>会場：{event.venue || '未入力'}</p><p>講師：{event.lecturer || '未入力'}</p><p>定員：{event.capacity ?? '未定'} · 参加費：{event.fee === null ? '未定' : `${event.fee.toLocaleString()}円`}</p><p>申込締切：{event.application_deadline ? date(event.application_deadline) : '未定'}</p>
      </div><OwnerEditor key={event.version} event={event} members={members} />
    </section>
    <section><h2 className="text-xl font-bold mb-4">担当タスク · 完了 {event.tasks.filter(task => task.status === 'DONE').length} / {event.tasks.length}</h2>
      <div className="space-y-4">{event.tasks.map(task => <TaskEditor key={`${task.id}-${task.version}`} task={task} members={members} />)}</div>
    </section>
    <AddTask eventId={event.id} />
    <SchedulePreviewForm event={event} />
    <section className="rounded-xl border bg-white p-5"><h2 className="font-bold mb-4">操作履歴（最新100件）</h2><ul className="space-y-3 text-sm">{history.map(row => {
      const before = row.before_json ? JSON.parse(row.before_json) : {}, after = row.after_json ? JSON.parse(row.after_json) : {};
      const memberName = (id: number | null) => id === null ? '未割当' : members.find(member => member.id === id)?.name ?? '登録メンバー';
      return <li key={row.id} className="border-b pb-3"><p>{date(row.occurred_at)} · {memberName(row.actor_id)} · {row.target_type === 'event' ? 'イベント' : event.tasks.find(task => task.id === row.target_id)?.title ?? 'タスク'}{row.action === 'created' ? '作成' : row.action === 'owner_updated' ? '責任者変更' : '更新'}</p>
        {before.status && before.status !== after.status && <p>状態：{TASK_STATUSES[before.status as keyof typeof TASK_STATUSES]} → {TASK_STATUSES[after.status as keyof typeof TASK_STATUSES]}</p>}
        {before.due_on && before.due_on !== after.due_on && <p>期限：{before.due_on} → {after.due_on}</p>}
        {Object.hasOwn(before, 'assignee_id') && before.assignee_id !== after.assignee_id && <p>主担当：{memberName(before.assignee_id)} → {memberName(after.assignee_id)}</p>}
        {Object.hasOwn(before, 'owner_id') && before.owner_id !== after.owner_id && <p>責任者：{memberName(before.owner_id)} → {memberName(after.owner_id)}</p>}
      </li>;
    })}</ul></section>
  </div>;
}
