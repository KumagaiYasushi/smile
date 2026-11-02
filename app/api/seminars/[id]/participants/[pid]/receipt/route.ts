import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { getDb } from '@/lib/db';
import { createReceiptStore } from '@/lib/receipts';
import { participantResponse } from '@/lib/participants-server';
import { parseId, TaskError } from '@/types/task';

type Params = { params: Promise<{ id: string; pid: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return participantResponse(async () => {
    const { id, pid } = await params;
    return createReceiptStore(getDb()).get(parseId(id), parseId(pid));
  });
}
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return participantResponse(async () => {
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    const { id, pid } = await params;
    return createReceiptStore(getDb()).issue(parseId(id), parseId(pid), actor.id);
  });
}
