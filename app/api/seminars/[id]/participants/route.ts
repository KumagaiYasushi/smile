import { NextRequest } from 'next/server';
import { getParticipantsBySeminar, createParticipant, getSeminarById } from '@/lib/db';
import { currentUser, requireMember } from '@/lib/auth-server';
import { participantResponse } from '@/lib/participants-server';
import { parseParticipant } from '@/types/participant';
import { TaskError, parseId } from '@/types/task';

type Params = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return participantResponse(async () => {
    const id = parseId((await params).id);
    if (!getSeminarById(id)) throw new TaskError('イベントが見つかりません', 404);
    return getParticipantsBySeminar(id);
  });
}
export async function POST(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return participantResponse(async () => {
    const id = parseId((await params).id);
    if (!getSeminarById(id)) throw new TaskError('イベントが見つかりません', 404);
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    return createParticipant({ seminar_id: id, ...parseParticipant(await request.json()) }, actor.id);
  }, 201);
}
