import { NextRequest } from 'next/server';
import { getParticipantById, updateParticipant, deleteParticipant } from '@/lib/db';
import { currentUser, requireMember } from '@/lib/auth-server';
import { participantResponse } from '@/lib/participants-server';
import { TaskError, parseId } from '@/types/task';

type Params = { params: Promise<{ id: string; pid: string }> };
async function scopedParticipant(params: Params['params']) {
  const { id, pid } = await params;
  const participant = getParticipantById(parseId(pid));
  if (!participant || participant.seminar_id !== parseId(id)) throw new TaskError('参加者が見つかりません', 404);
  return participant;
}
export async function GET(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return participantResponse(() => scopedParticipant(params));
}
export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return participantResponse(async () => {
    const participant = await scopedParticipant(params);
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    const updated = updateParticipant(participant.id, await request.json(), actor.id);
    if (!updated) throw new TaskError('参加者が見つかりません', 404);
    return updated;
  });
}
export async function DELETE(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request); if (denied) return denied;
  return participantResponse(async () => {
    const participant = await scopedParticipant(params);
    if (!deleteParticipant(participant.id)) throw new TaskError('参加者が見つかりません', 404);
    return { success: true };
  });
}
