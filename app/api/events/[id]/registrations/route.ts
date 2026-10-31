import { registrationApi } from '@/lib/registration-api';
import { routeId } from '@/lib/event-api';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return registrationApi(request, async store => store.forEvent(routeId((await params).id)));
}
export async function POST(request: Request, { params }: Context) {
  return registrationApi(request, async (store, actor) => store.register(routeId((await params).id), await request.json(), actor), 201);
}
