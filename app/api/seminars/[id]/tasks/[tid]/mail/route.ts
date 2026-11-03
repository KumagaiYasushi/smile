import {NextRequest} from 'next/server';
import {requireMember,currentUser} from '@/lib/auth-server';
import {taskResponse} from '@/lib/task-server';
import {createTaskMailStore} from '@/lib/task-mail';
import {getDb,getSeminarById} from '@/lib/db';
import {parseId,TaskError} from '@/types/task';
type Context={params:Promise<{id:string;tid:string}>};
async function scoped(context:Context){const p=await context.params,event=getSeminarById(parseId(p.id));if(!event)throw new TaskError('イベントが見つかりません',404);return {event,taskId:parseId(p.tid)};}
export async function GET(request:NextRequest,context:Context){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>{const {event,taskId}=await scoped(context);const store=createTaskMailStore(getDb());return {mail:store.read(event,taskId),template:store.template(event,taskId)};});}
export async function PATCH(request:NextRequest,context:Context){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>{const {event,taskId}=await scoped(context);return {mail:createTaskMailStore(getDb()).save(event,taskId,await request.json(),(await currentUser())!.id)};});}
