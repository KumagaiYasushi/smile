import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { venueStore, venueResponse } from '@/lib/venue-server';
import { parseId, TaskError } from '@/types/task';

type Params = { params: Promise<{ vid: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return venueResponse(async () => {
    const id = parseId((await params).vid), store = venueStore();
    return { venue: store.get(id), history: store.history(id) };
  });
}
export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return venueResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    return { venue: venueStore().update(parseId((await params).vid), await request.json(), actor.id) };
  });
}
