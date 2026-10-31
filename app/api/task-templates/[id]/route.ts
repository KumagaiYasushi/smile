import { eventApi, routeId } from '@/lib/event-api';
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return eventApi(request, async (store, actor) => store.saveTemplate(await request.json(), actor, routeId((await params).id)));
}
