import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { staffAttendanceStore, staffAttendanceResponse } from '@/lib/staff-attendance-server';
import { parseId, TaskError } from '@/types/task';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return staffAttendanceResponse(async () => {
    const id = parseId((await params).id), store = staffAttendanceStore();
    return { ...store.list(id), history: store.history(id) };
  });
}
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return staffAttendanceResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    return { person: staffAttendanceStore().create(parseId((await params).id), await request.json(), actor.id) };
  }, 201);
}
