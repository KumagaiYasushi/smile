import {syncCalendar} from '@/lib/calendar-server';
import {createMailHistoryStore} from '@/lib/mail-history';
import {timingSafeEqual} from 'node:crypto';
import {NextRequest} from 'next/server';
import {privateJson} from '@/lib/auth-server';
import {getDb} from '@/lib/db';
import {createGmailStore} from '@/lib/gmail';
import {createTaskMailStore} from '@/lib/task-mail';
export async function POST(request:NextRequest){const secret=process.env.GMAIL_SYNC_SECRET;if(!secret||secret.length<32)return privateJson({error:'定期同期は未設定です'},503);const expected=Buffer.from(`Bearer ${secret}`),actual=Buffer.from(request.headers.get('authorization')??'');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return privateJson({error:'認証できません'},401);const db=getDb(),gmail=createGmailStore(db),mail=createTaskMailStore(db),users=db.prepare('SELECT c.user_id FROM gmail_connections c JOIN auth_users u ON c.user_id=u.id WHERE u.active=1').all() as {user_id:number}[];let updated=0,failed=0;for(const user of users)try{updated+=(await mail.sync(user.user_id,gmail)).updated;updated+=(await createMailHistoryStore(db).sync(user.user_id,gmail)).updated;}catch{failed++;}let calendar;try{calendar=await syncCalendar();}catch{failed++;}return privateJson({updated,failed,calendar},failed?502:200);}
