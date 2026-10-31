import { registrationApi } from '@/lib/registration-api';
import { EventError } from '@/lib/event-store';
export async function POST(request: Request) {
  return registrationApi(request, async store => {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['query', 'page'].includes(key)) || typeof body.query !== 'string') throw new EventError('検索条件を確認してください');
    return store.search(body.query, body.page ?? 1);
  });
}
