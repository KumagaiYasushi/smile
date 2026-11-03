import {NextRequest} from 'next/server';
import {requireMember,currentUser} from '@/lib/auth-server';
import {taskResponse} from '@/lib/task-server';
import {createTaskMailStore} from '@/lib/task-mail';
import {createGmailStore,gmailConfig} from '@/lib/gmail';
import {getDb,getSeminarById} from '@/lib/db';
import {parseId,TaskError} from '@/types/task';
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string;tid:string}>}){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>{const p=await params,event=getSeminarById(parseId(p.id));if(!event)throw new TaskError('イベントが見つかりません',404);const body=await request.json();if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>k!=='version'))throw new TaskError('送信の入力形式が不正です');return {mail:await createTaskMailStore(getDb()).send(event,parseId(p.tid),body.version,(await currentUser())!.id,createGmailStore(getDb()),gmailConfig().origin)};});}
