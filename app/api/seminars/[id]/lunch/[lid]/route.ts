import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { lunchStore, lunchResponse } from '@/lib/lunch-server';
import { parseId, TaskError } from '@/types/task';

type Params = { params: Promise<{ id: string; lid: string }> };
export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return lunchResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    const { id, lid } = await params;
    return { plan: lunchStore().update(parseId(id), parseId(lid), await request.json(), actor.id) };
  });
}
export async function DELETE(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return lunchResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    const { id, lid } = await params;
    return lunchStore().remove(parseId(id), parseId(lid), await request.json(), actor.id);
  });
}
