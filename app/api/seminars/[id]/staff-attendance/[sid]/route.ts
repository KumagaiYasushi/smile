import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { staffAttendanceStore, staffAttendanceResponse } from '@/lib/staff-attendance-server';
import { parseId, TaskError } from '@/types/task';

type Params = { params: Promise<{ id: string; sid: string }> };
export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return staffAttendanceResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    const { id, sid } = await params;
    return { person: staffAttendanceStore().update(parseId(id), parseId(sid), await request.json(), actor.id) };
  });
}
export async function DELETE(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return staffAttendanceResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    const { id, sid } = await params;
    return staffAttendanceStore().remove(parseId(id), parseId(sid), await request.json(), actor.id);
  });
}
