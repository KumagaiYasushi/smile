import {NextRequest} from 'next/server';
import {requireMember,currentUser} from '@/lib/auth-server';
import {taskResponse} from '@/lib/task-server';
import {getDb} from '@/lib/db';
import {createEventRoleStore} from '@/lib/event-roles';
import {parseId} from '@/types/task';
type Context={params:Promise<{id:string}>};
export async function GET(request:NextRequest,{params}:Context){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>createEventRoleStore(getDb()).read(parseId((await params).id)));}
export async function PUT(request:NextRequest,{params}:Context){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>createEventRoleStore(getDb()).save(parseId((await params).id),await request.json(),(await currentUser())!.id));}
