import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { lunchStore, lunchResponse } from '@/lib/lunch-server';
import { parseId, TaskError } from '@/types/task';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return lunchResponse(async () => {
    const id = parseId((await params).id), store = lunchStore();
    return { ...store.list(id), history: store.history(id) };
  });
}
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return lunchResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    return { plan: lunchStore().create(parseId((await params).id), await request.json(), actor.id) };
  }, 201);
}
