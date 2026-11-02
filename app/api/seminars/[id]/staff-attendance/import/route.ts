import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { staffAttendanceStore, staffAttendanceResponse } from '@/lib/staff-attendance-server';
import { parseId, TaskError } from '@/types/task';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireMember(request); if (denied) return denied;
  return staffAttendanceResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    return staffAttendanceStore().importNames(parseId((await params).id), await request.json(), actor.id);
  });
}
