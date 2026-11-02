import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { taskResponse, taskStore } from '@/lib/task-server';
import { parseId, TaskError } from '@/types/task';

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request);
  if (denied) return denied;
  return taskResponse(async () => ({ tasks: taskStore().listTasks(parseId((await params).id)) }));
}

export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request);
  if (denied) return denied;
  return taskResponse(async () => {
    const actor = await currentUser();
    if (!actor) throw new TaskError('ログインが必要です', 401);
    return { task: taskStore().createTask(parseId((await params).id), await request.json(), actor.id) };
  }, 201);
}
