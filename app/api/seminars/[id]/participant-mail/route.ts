import {NextRequest} from 'next/server';
import {currentUser,requireMember} from '@/lib/auth-server';
import {participantResponse} from '@/lib/participants-server';
import {getDb} from '@/lib/db';
import {createParticipantMailStore} from '@/lib/participant-mail';
import {createGmailStore} from '@/lib/gmail';
import {participantFormScript} from '@/lib/participant-form-script';
import {processParticipantMail} from '@/lib/participant-mail-server';
import {parseId,TaskError} from '@/types/task';
type Context={params:Promise<{id:string}>};
export async function GET(request:NextRequest,{params}:Context){const denied=await requireMember(request);if(denied)return denied;return participantResponse(async()=>{const actor=(await currentUser())!;return {...createParticipantMailStore(getDb()).read(parseId((await params).id)),gmail:createGmailStore(getDb()).status(actor.id),actor_id:actor.id};});}
export async function PATCH(request:NextRequest,{params}:Context){const denied=await requireMember(request);if(denied)return denied;return participantResponse(async()=>createParticipantMailStore(getDb()).save(parseId((await params).id),await request.json(),(await currentUser())!.id,createGmailStore(getDb())));}
export async function POST(request:NextRequest,{params}:Context){const denied=await requireMember(request);if(denied)return denied;return participantResponse(async()=>{const id=parseId((await params).id),body=await request.json();if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length!==1||!['script','dispatch'].includes(body.action))throw new TaskError('自動メールの操作が不正です');if(body.action==='dispatch')return processParticipantMail(id);const origin=process.env.APP_ORIGIN;if(!origin||!origin.startsWith('https://'))throw new TaskError('HTTPSの公開URL（APP_ORIGIN）を設定してから連携してください',503);const token=createParticipantMailStore(getDb()).rotateToken(id,(await currentUser())!.id);return {script:participantFormScript(`${new URL(origin).origin}/api/forms/${id}`,token)};});}
