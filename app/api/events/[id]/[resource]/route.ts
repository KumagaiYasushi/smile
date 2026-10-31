import { EventError } from '@/lib/event-store';
import { eventApi, routeId } from '@/lib/event-api';
type Context = { params: Promise<{ id: string; resource: string }> };
export async function GET(request: Request, { params }: Context) {
  return eventApi(request, async store => {
    const { id, resource } = await params;
    if (resource === 'tasks') return store.get(routeId(id)).tasks;
    if (resource === 'history') return store.history(routeId(id));
    throw new EventError('見つかりません', 404);
  });
}
export async function POST(request: Request, { params }: Context) {
  return eventApi(request, async (store, actor) => {
    const { id, resource } = await params;
    if (resource === 'tasks') return store.addTask(routeId(id), await request.json(), actor);
    if (resource === 'schedule-preview') return store.preview(routeId(id), await request.json());
    throw new EventError('見つかりません', 404);
  });
}
