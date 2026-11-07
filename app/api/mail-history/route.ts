import {NextRequest} from 'next/server';
import {requireMember,currentUser} from '@/lib/auth-server';
import {taskResponse} from '@/lib/task-server';
import {getDb} from '@/lib/db';
import {createMailHistoryStore} from '@/lib/mail-history';
import {createGmailStore} from '@/lib/gmail';
import {parseId,TaskError} from '@/types/task';
export async function GET(request:NextRequest){const denied=await requireMember(request);if(denied)return denied;return taskResponse(()=>{const p=request.nextUrl.searchParams;return createMailHistoryStore(getDb()).list({page:p.has('page')?parseId(p.get('page')!):1,kind:p.get('kind')??'ALL',event_id:p.has('event_id')?parseId(p.get('event_id')!):undefined,search:p.get('search')??'',order:p.get('order')??'desc'});});}
export async function POST(request:NextRequest){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>{const body=await request.json();if(!body||typeof body!=='object'||Object.keys(body).length!==1||body.action!=='sync')throw new TaskError('履歴の確認操作が不正です');return createMailHistoryStore(getDb()).sync((await currentUser())!.id,createGmailStore(getDb()));});}
