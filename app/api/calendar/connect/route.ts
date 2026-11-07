import {NextRequest} from 'next/server';
import {requireMember,currentUser,privateJson} from '@/lib/auth-server';
import {getDb} from '@/lib/db';
import {createCalendarGoogle} from '@/lib/calendar-google';
import {TaskError} from '@/types/task';
export async function POST(request:NextRequest){const denied=await requireMember(request,'admin');if(denied)return denied;try{const r=createCalendarGoogle(getDb()).begin((await currentUser())!.id),response=privateJson({url:r.url});response.cookies.set('smile_calendar_state',r.state,{httpOnly:true,secure:true,sameSite:'lax',path:'/api/calendar',maxAge:600});return response;}catch(e){return privateJson({error:e instanceof TaskError?e.message:'Googleに接続できませんでした'},e instanceof TaskError?e.status:500);}}
