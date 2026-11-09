import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { getDb } from '@/lib/db';
import { createMemberPageStore } from '@/lib/member-page';
import { taskResponse } from '@/lib/task-server';
import { parseId } from '@/types/task';

export async function GET(request: NextRequest) {
  const denied = await requireMember(request);
  if (denied) return denied;
  return taskResponse(async () => {
    const id = request.nextUrl.searchParams.get('member_id');
    return createMemberPageStore(getDb()).read(id === null ? null : parseId(id), (await currentUser())!.id);
  });
}
