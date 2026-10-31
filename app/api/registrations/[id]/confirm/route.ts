import { registrationApi } from '@/lib/registration-api';
import { routeId } from '@/lib/event-api';
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return registrationApi(request, async (store, actor) => store.confirm(routeId((await params).id), await request.json(), actor));
}
