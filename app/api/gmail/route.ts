import {NextRequest} from 'next/server';
import {requireMember,currentUser} from '@/lib/auth-server';
import {taskResponse} from '@/lib/task-server';
import {createGmailStore} from '@/lib/gmail';
import {getDb} from '@/lib/db';
export async function GET(request:NextRequest){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>createGmailStore(getDb()).status((await currentUser())!.id));}
export async function DELETE(request:NextRequest){const denied=await requireMember(request);if(denied)return denied;return taskResponse(async()=>{createGmailStore(getDb()).disconnect((await currentUser())!.id);return {disconnected:true};});}
