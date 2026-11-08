import {NextRequest} from 'next/server';
import {requireMember,privateJson} from '@/lib/auth-server';
import {getDb,getAllSeminars} from '@/lib/db';
import {createMeetingStore} from '@/lib/meetings';
import {buildEventList} from '@/types/event-list';
export async function GET(request:NextRequest){const denied=await requireMember(request);if(denied)return denied;try{const db=getDb(),meetings=createMeetingStore(db);return privateJson(db.transaction(()=>{const seminars=getAllSeminars();return {seminars,entries:buildEventList(seminars,seminars.flatMap(e=>meetings.list(e.id)))};})());}catch{return privateJson({error:'予定一覧を取得できませんでした'},500);}}
