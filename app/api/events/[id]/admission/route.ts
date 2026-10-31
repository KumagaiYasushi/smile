import { registrationApi } from '@/lib/registration-api';
import { routeId } from '@/lib/event-api';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  return registrationApi(request, async store => store.admission(routeId((await params).id)));
}
export async function PATCH(request: Request, { params }: Context) {
  return registrationApi(request, async (store, actor) => store.setCapacity(routeId((await params).id), await request.json(), actor));
}
