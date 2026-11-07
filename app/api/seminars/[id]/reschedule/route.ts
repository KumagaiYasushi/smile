import {scheduleCalendarSync} from '@/lib/calendar-server';
import { NextRequest } from 'next/server';
import { requireMember, currentUser } from '@/lib/auth-server';
import { updateSeminar } from '@/lib/db';
import { taskResponse } from '@/lib/task-server';
import { rescheduleStore } from '@/lib/reschedule-server';
import { parseId, TaskError } from '@/types/task';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireMember(request); if (denied) return denied;
  return taskResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    const id = parseId((await params).id);
    const result=rescheduleStore().apply(id, await request.json(), actor.id, (dates) => updateSeminar(id, { dates }));
    scheduleCalendarSync();return result;
  });
}
