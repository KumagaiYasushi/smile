import { eventApi, routeId } from '@/lib/event-api';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return eventApi(request, async store => store.get(routeId((await params).id)));
}
export async function PATCH(request: Request, { params }: Context) {
  return eventApi(request, async (store, actor) => store.updateOwner(routeId((await params).id), await request.json(), actor));
}
