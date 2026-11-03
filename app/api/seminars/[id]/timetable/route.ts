import {NextRequest} from 'next/server';
import {requireMember,currentUser} from '@/lib/auth-server';
import {taskResponse} from '@/lib/task-server';
import {getDb,getSeminarById} from '@/lib/db';
import {createTimetableStore} from '@/lib/timetable';
import {parseId,TaskError} from '@/types/task';
type Context={params:Promise<{id:string}>};
async function event(context:Context){const e=getSeminarById(parseId((await context.params).id));if(!e)throw new TaskError('イベントが見つかりません',404);return e;}
export async function GET(request:NextRequest,context:Context){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>createTimetableStore(getDb()).read(await event(context)));}
export async function PUT(request:NextRequest,context:Context){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>createTimetableStore(getDb()).save(await event(context),await request.json(),(await currentUser())!.id));}
