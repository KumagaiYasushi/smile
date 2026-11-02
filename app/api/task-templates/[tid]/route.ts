import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { taskResponse } from '@/lib/task-server';
import { templateStore } from '@/lib/template-server';
import { parseId, parseVersion, TaskError } from '@/types/task';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tid: string }> }) {
  const denied = await requireMember(request); if (denied) return denied;
  return taskResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TaskError('入力形式が不正です');
    const { version, ...input } = body;
    return { template: templateStore().updateTemplate(parseId((await params).tid), input, parseVersion(version), actor.id) };
  });
}
