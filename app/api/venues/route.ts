import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { venueStore, venueResponse } from '@/lib/venue-server';
import { TaskError } from '@/types/task';
import type { VenueStatus } from '@/types/venue';

export async function GET(request: NextRequest) {
  const denied = await requireMember(request); if (denied) return denied;
  return venueResponse(() => {
    const query = request.nextUrl.searchParams;
    if ([...query.keys()].some(key => !['query', 'status'].includes(key)) || query.getAll('query').length > 1 || query.getAll('status').length > 1) throw new TaskError('検索条件が不正です');
    return { venues: venueStore().list(query.get('query') ?? '', (query.get('status') ?? 'ACTIVE') as VenueStatus) };
  });
}
export async function POST(request: NextRequest) {
  const denied = await requireMember(request); if (denied) return denied;
  return venueResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    return { venue: venueStore().create(await request.json(), actor.id) };
  }, 201);
}
