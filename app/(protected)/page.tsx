import Link from 'next/link';
import { currentIdentity } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { eventPageStore } from '@/lib/event-page';
import { jstDate } from '@/lib/event-store';
import { TASK_STATUSES } from '@/types/event';

export default async function Dashboard() {
  const identity = await currentIdentity();
  if (!identity) redirect('/login');
  const store = await eventPageStore();
  const events = store.list();
  const tasks = events.flatMap(event => store.get(event.id).tasks.map(task => ({ ...task, eventTitle: event.title })));
  const open = tasks.filter(task => task.status !== 'DONE');
  const today = jstDate(new Date().toISOString());
  const nextWeek = new Date(Date.parse(today) + 7 * 86400000).toISOString().slice(0, 10);
  const groups = [
    { title: '未割当', rows: open.filter(task => task.assignee_id === null) },
    { title: '期限超過', rows: open.filter(task => task.due_on < today) },
    { title: '確認待ち', rows: open.filter(task => task.status === 'REVIEW') },
    { title: '今後7日間の重要タスク', rows: open.filter(task => task.important && task.due_on >= today && task.due_on <= nextWeek) },
  ];
  return <div>
    <h1 className="text-2xl font-bold text-slate-800">企画運営ホーム</h1>
    <p className="text-slate-600 mt-2">{identity.name}さん、企画の準備を進めましょう。</p>
    <div className="flex flex-wrap gap-4 mt-6"><Link href="/events" className="rounded-lg bg-sky-800 px-5 py-3 text-white font-bold">イベント一覧</Link><Link href="/events/new" className="rounded-lg border border-sky-800 px-5 py-3 text-sky-900">＋ イベント作成</Link></div>
    <div className="grid gap-4 md:grid-cols-2 mt-6">{groups.map(group => <section key={group.title} className="rounded-xl border bg-white p-5"><h2 className="font-bold">{group.title} · {group.rows.length}件</h2>{group.rows.length === 0 ? <p className="text-sm text-slate-500 mt-3">該当するタスクはありません</p> : <ul className="mt-3 space-y-3">{group.rows.map(task => <li key={task.id}><Link className="text-sky-800 underline" href={`/events/${task.event_id}#task-${task.id}`}>{task.title}</Link><p className="text-xs text-slate-600">{task.eventTitle} · {task.due_on} · {TASK_STATUSES[task.status]}</p></li>)}</ul>}</section>)}</div>
    <p className="text-sm text-slate-600 mt-6">日付と期限は日本時間で表示しています。Google・LINE・メールの連携は未接続です。</p>
  </div>;
}
