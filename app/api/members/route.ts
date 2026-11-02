import { NextRequest } from 'next/server';
import { requireMember } from '@/lib/auth-server';
import { taskResponse, taskStore } from '@/lib/task-server';

export async function GET(request: NextRequest) {
  const denied = await requireMember(request);
  if (denied) return denied;
  return taskResponse(() => ({ members: taskStore().listMembers() }));
}
