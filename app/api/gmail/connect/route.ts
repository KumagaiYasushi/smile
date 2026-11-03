import {NextRequest} from 'next/server';
import {requireMember,currentUser,privateJson} from '@/lib/auth-server';
import {TaskError} from '@/types/task';
import {createGmailStore} from '@/lib/gmail';
import {getDb} from '@/lib/db';
export async function POST(request:NextRequest){const denied=await requireMember(request);if(denied)return denied;try{const result=createGmailStore(getDb()).begin((await currentUser())!.id);const response=privateJson({url:result.url});response.cookies.set('smile_gmail_state',result.state,{httpOnly:true,secure:true,sameSite:'lax',path:'/api/gmail',maxAge:600});return response;}catch(error){return privateJson({error:error instanceof TaskError?error.message:'Googleへの接続を開始できませんでした'},error instanceof TaskError?error.status:500);}}
