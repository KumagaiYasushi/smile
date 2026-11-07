import {NextRequest} from 'next/server';
import {requireMember,currentUser,privateJson} from '@/lib/auth-server';
import {getDb} from '@/lib/db';
import {createCalendarGoogle} from '@/lib/calendar-google';
import {createCalendarSyncStore} from '@/lib/calendar-sync';
import {syncCalendar} from '@/lib/calendar-server';
import {TaskError} from '@/types/task';
async function result(action:()=>unknown|Promise<unknown>){try{return privateJson(await action());}catch(e){return privateJson({error:e instanceof TaskError?e.message:'カレンダーの処理を完了できませんでした'},e instanceof TaskError?e.status:500);}}
export async function GET(request:NextRequest){const denied=await requireMember(request);if(denied)return denied;return result(async()=>({...createCalendarGoogle(getDb()).status(),...createCalendarSyncStore(getDb()).status(),can_manage:(await currentUser())!.role==='admin'}));}
export async function POST(request:NextRequest){const denied=await requireMember(request);if(denied)return denied;return result(async()=>{const b=await request.json();if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>k!=='all')||typeof b.all!=='boolean')throw new TaskError('同期の入力形式が不正です');return syncCalendar(b.all);});}
export async function DELETE(request:NextRequest){const denied=await requireMember(request,'admin');if(denied)return denied;return result(async()=>{createCalendarGoogle(getDb()).disconnect((await currentUser())!.id);return {success:true};});}
