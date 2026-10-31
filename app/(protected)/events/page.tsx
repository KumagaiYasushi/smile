import Link from 'next/link';
import { eventPageStore } from '@/lib/event-page';
import { EVENT_TYPES } from '@/types/event';
import { jstDate } from '@/lib/event-store';

export default async function EventsPage() {
  const store = await eventPageStore();
  const members = store.members(), events = store.list();
  return <div>
    <div className="flex flex-wrap gap-4 justify-between items-center mb-6"><h1 className="text-2xl font-bold">イベント一覧</h1><Link href="/events/new" className="rounded-lg bg-sky-800 px-4 py-2 text-white">＋ イベント作成</Link></div>
    <Link href="/task-templates" className="text-sky-800 underline">標準タスクテンプレートを管理</Link>
    {!events.length && <p className="rounded-xl bg-white border p-8 mt-6">イベントはまだありません。標準タスクを登録してから作成できます。</p>}
    <div className="grid gap-4 md:grid-cols-2 mt-6">{events.map(event => {
      const tasks = store.get(event.id).tasks, completed = tasks.filter(task => task.status === 'DONE').length;
      return <Link href={`/events/${event.id}`} key={event.id} className="rounded-xl border border-slate-200 bg-white p-5 hover:border-sky-600">
        <p className="text-sm text-sky-800">{EVENT_TYPES[event.type]}</p><h2 className="font-bold text-xl mt-2">{event.title}</h2>
        <p className="text-sm mt-3">初回開催：{jstDate(event.starts_at)} · {event.venue || '会場未入力'}</p>
        <p className="text-sm mt-2">責任者：{members.find(member => member.id === event.owner_id)?.name ?? '未設定'}</p>
        <p className="text-sm mt-2">タスク完了 {completed} / {tasks.length}</p>
      </Link>;
    })}</div>
  </div>;
}
