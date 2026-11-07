import {scheduleCalendarSync} from '@/lib/calendar-server';
import {NextRequest} from 'next/server';
import {currentUser,requireMember} from '@/lib/auth-server';
import {participantResponse} from '@/lib/participants-server';
import {getDb} from '@/lib/db';
import {createMeetingStore} from '@/lib/meetings';
import {TaskError,parseId} from '@/types/task';
type Params={params:Promise<{id:string}>};
export async function GET(request:NextRequest,{params}:Params){const denied=await requireMember(request);if(denied)return denied;return participantResponse(async()=>createMeetingStore(getDb()).data(parseId((await params).id)));}
export async function POST(request:NextRequest,{params}:Params){const denied=await requireMember(request);if(denied)return denied;return participantResponse(async()=>{const actor=await currentUser();if(!actor)throw new TaskError('ログインが必要です',401);const body=await request.json();if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>key!=='changes'))throw new TaskError('打ち合わせの変更形式が不正です');const result=createMeetingStore(getDb()).apply(parseId((await params).id),body.changes,actor.id);scheduleCalendarSync();return result;});}
