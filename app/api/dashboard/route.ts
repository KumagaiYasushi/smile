import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { getDb } from '@/lib/db';
import { createDashboardStore } from '@/lib/dashboard';
import { taskResponse } from '@/lib/task-server';
import { parseDashboardQuery } from '@/types/dashboard';
import { TaskError } from '@/types/task';

export async function GET(request: NextRequest) {
  const denied = await requireMember(request); if (denied) return denied;
  return taskResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    return createDashboardStore(getDb()).getDashboard(actor.id, parseDashboardQuery(request.nextUrl.searchParams));
  });
}
