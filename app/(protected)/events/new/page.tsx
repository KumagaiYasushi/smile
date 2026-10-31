import { eventPageStore } from '@/lib/event-page';
import { EventForm } from '@/components/EventForms';
export default async function NewEvent() {
  const store = await eventPageStore();
  return <div><h1 className="text-2xl font-bold mb-6">イベントを作成</h1><EventForm members={store.members()} templates={store.templates()} /></div>;
}
