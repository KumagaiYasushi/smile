import {scheduleCalendarSync} from '@/lib/calendar-server';
import {NextRequest} from 'next/server';
import {currentUser,requireMember,privateJson} from '@/lib/auth-server';
import {getDb} from '@/lib/db';
import {createMeetingPollStore} from '@/lib/meeting-poll';
import {TaskError,parseId} from '@/types/task';
type Params={params:Promise<{id:string}>};
async function response(action:()=>unknown|Promise<unknown>){try{return privateJson(await action());}catch(e){if(e instanceof TaskError)return privateJson({error:e.message},e.status);if(e instanceof SyntaxError)return privateJson({error:'入力形式が不正です'},400);return privateJson({error:'日程調整を保存・取得できませんでした'},500);}}
export async function GET(request:NextRequest,{params}:Params){const denied=await requireMember(request);if(denied)return denied;return response(async()=>createMeetingPollStore(getDb()).data(parseId((await params).id)));}
export async function PUT(request:NextRequest,{params}:Params){const denied=await requireMember(request);if(denied)return denied;return response(async()=>createMeetingPollStore(getDb()).save(parseId((await params).id),await request.json(),(await currentUser())!.id));}
export async function PATCH(request:NextRequest,{params}:Params){const denied=await requireMember(request);if(denied)return denied;return response(async()=>createMeetingPollStore(getDb()).answer(parseId((await params).id),await request.json(),(await currentUser())!.id));}

export async function POST(request:NextRequest,{params}:Params){const denied=await requireMember(request);if(denied)return denied;return response(async()=>{const result=createMeetingPollStore(getDb()).decide(parseId((await params).id),await request.json(),(await currentUser())!.id);scheduleCalendarSync();return result;});}
