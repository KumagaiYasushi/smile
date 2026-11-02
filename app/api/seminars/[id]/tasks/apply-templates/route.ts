import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { taskResponse } from '@/lib/task-server';
import { generationInput, templateStore } from '@/lib/template-server';
import { parseId, TaskError } from '@/types/task';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireMember(request); if (denied) return denied;
  return taskResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    const input = generationInput(await request.json(), true);
    return templateStore().apply(parseId((await params).id), input.baseDate, input.token, actor.id);
  });
}
