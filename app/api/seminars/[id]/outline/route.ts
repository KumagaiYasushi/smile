import {NextRequest} from 'next/server';
import {requireMember} from '@/lib/auth-server';
import {participantResponse} from '@/lib/participants-server';
import {getSeminarById} from '@/lib/db';
import {buildEventOutline} from '@/lib/event-outline';
import {parseId,TaskError} from '@/types/task';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const denied=await requireMember(request);if(denied)return denied;
  return participantResponse(async()=>{const event=getSeminarById(parseId((await params).id));if(!event)throw new TaskError('イベントが見つかりません',404);return buildEventOutline(event);});
}
