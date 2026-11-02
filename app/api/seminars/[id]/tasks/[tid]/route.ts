import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { taskResponse, taskStore } from '@/lib/task-server';
import { parseId, parseVersion, TaskError } from '@/types/task';

type Params = { params: Promise<{ id: string; tid: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request);
  if (denied) return denied;
  return taskResponse(async () => {
    const { id, tid } = await params;
    const store = taskStore();
    const seminarId = parseId(id), taskId = parseId(tid);
    return { task: store.getTask(seminarId, taskId), history: store.history(seminarId, taskId) };
  });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request);
  if (denied) return denied;
  return taskResponse(async () => {
    const actor = await currentUser();
    if (!actor) throw new TaskError('ログインが必要です', 401);
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TaskError('入力形式が不正です');
    const { version, ...input } = body;
    const { id, tid } = await params;
    return { task: taskStore().updateTask(parseId(id), parseId(tid), input, parseVersion(version), actor.id) };
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request);
  if (denied) return denied;
  return taskResponse(async () => {
    const actor = await currentUser();
    if (!actor) throw new TaskError('ログインが必要です', 401);
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => key !== 'version')) throw new TaskError('入力形式が不正です');
    const { id, tid } = await params;
    taskStore().deleteTask(parseId(id), parseId(tid), parseVersion(body.version), actor.id);
    return { success: true };
  });
}
