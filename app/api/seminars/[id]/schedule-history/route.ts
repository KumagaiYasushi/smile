import { NextRequest } from 'next/server';
import { requireMember } from '@/lib/auth-server';
import { taskResponse } from '@/lib/task-server';
import { rescheduleStore } from '@/lib/reschedule-server';
import { parseId } from '@/types/task';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireMember(request); if (denied) return denied;
  return taskResponse(async () => ({ history: rescheduleStore().history(parseId((await params).id)) }));
}
