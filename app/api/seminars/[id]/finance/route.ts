import {NextRequest} from 'next/server';
import {requireMember,currentUser} from '@/lib/auth-server';
import {taskResponse} from '@/lib/task-server';
import {getDb,getSeminarById} from '@/lib/db';
import {createFinanceStore} from '@/lib/event-finance';
import {parseId,TaskError} from '@/types/task';
type Context={params:Promise<{id:string}>};
async function eventFor(context:Context){const event=getSeminarById(parseId((await context.params).id));if(!event)throw new TaskError('イベントが見つかりません',404);return event;}
export async function GET(request:NextRequest,context:Context){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>createFinanceStore(getDb()).read(await eventFor(context)));}
export async function PATCH(request:NextRequest,context:Context){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>{const actor=await currentUser();if(!actor)throw new TaskError('ログインが必要です',401);return createFinanceStore(getDb()).save(await eventFor(context),await request.json(),actor.id);});}
