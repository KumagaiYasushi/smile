import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { participantResponse } from '@/lib/participants-server';
import { createSocietyMemberStore } from '@/lib/society-members';
import { getDb } from '@/lib/db';
import { TaskError,parseId } from '@/types/task';
export async function PATCH(request:NextRequest,{params}:{params:Promise<{mid:string}>}) {
  const denied=await requireMember(request); if(denied) return denied;
  return participantResponse(async()=>{
    const actor=await currentUser(); if(!actor) throw new TaskError('ログインが必要です',401);
    return createSocietyMemberStore(getDb()).save(await request.json(),actor.id,parseId((await params).mid));
  });
}
