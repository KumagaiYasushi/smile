import {NextRequest} from 'next/server';
import {requireMember} from '@/lib/auth-server';
import {taskResponse} from '@/lib/task-server';
import {getDb} from '@/lib/db';
import {createMailHistoryStore} from '@/lib/mail-history';
import {parseId} from '@/types/task';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>createMailHistoryStore(getDb()).detail(parseId((await params).id)));}
