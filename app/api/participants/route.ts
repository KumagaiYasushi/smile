import { registrationApi } from '@/lib/registration-api';
import { routeId } from '@/lib/event-api';
import { EventError } from '@/lib/event-store';
export async function GET(request: Request) {
  return registrationApi(request, store => {
    const query = new URL(request.url).searchParams;
    if ([...query.keys()].some(key => key !== 'page')) throw new EventError('検索は専用の検索フォームを利用してください');
    return store.search('', routeId(query.get('page') ?? '1'));
  });
}
