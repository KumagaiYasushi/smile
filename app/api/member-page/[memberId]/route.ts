import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { getDb } from '@/lib/db';
import { createMemberPageStore } from '@/lib/member-page';
import { taskResponse } from '@/lib/task-server';
import { parseId, TaskError } from '@/types/task';

export async function POST(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const denied = await requireMember(request);
  if (denied) return denied;
  return taskResponse(async () => {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(k => !['action', 'event_id', 'task_id', 'data'].includes(k))) throw new TaskError('入力形式が不正です');
    const id = parseId((await params).memberId), eventId = parseId(String(body.event_id));
    const store = createMemberPageStore(getDb()), actor = (await currentUser())!.id;
    if (body.action === 'attendance' && body.task_id === undefined) store.setAttendance(id, eventId, body.data, actor);
    else if (body.action === 'task') store.setTaskStatus(id, eventId, parseId(String(body.task_id)), body.data, actor);
    else throw new TaskError('変更できるのは出欠・タスク進捗です');
    return store.read(id, actor);
  });
}
