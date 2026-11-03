import {NextRequest} from 'next/server';
import {requireMember,currentUser} from '@/lib/auth-server';
import {taskResponse} from '@/lib/task-server';
import {createGmailStore} from '@/lib/gmail';
import {createTaskMailStore} from '@/lib/task-mail';
import {getDb} from '@/lib/db';
export async function POST(request:NextRequest){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>{const actor=(await currentUser())!,gmail=createGmailStore(getDb());if(!gmail.status(actor.id).connected)return {updated:0,connected:false};return createTaskMailStore(getDb()).sync(actor.id,gmail);});}
