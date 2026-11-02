import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { taskResponse } from '@/lib/task-server';
import { templateStore } from '@/lib/template-server';
import { isEventType } from '@/types/seminar';
import { TaskError } from '@/types/task';

export async function GET(request: NextRequest) {
  const denied = await requireMember(request); if (denied) return denied;
  return taskResponse(() => {
    const type = request.nextUrl.searchParams.get('event_type');
    if (type !== null && !isEventType(type)) throw new TaskError('イベント種別が不正です');
    return { templates: templateStore().listTemplates(type ?? undefined) };
  });
}

export async function POST(request: NextRequest) {
  const denied = await requireMember(request); if (denied) return denied;
  return taskResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    return { template: templateStore().createTemplate(await request.json(), actor.id) };
  }, 201);
}
