import {NextRequest} from 'next/server';
import {requireMember} from '@/lib/auth-server';
import {participantResponse} from '@/lib/participants-server';
import {getDb,getAllSeminars} from '@/lib/db';
import {createMeetingStore} from '@/lib/meetings';
import {buildHomeRows} from '@/types/home';
export async function GET(request:NextRequest){const denied=await requireMember(request);if(denied)return denied;return participantResponse(()=>{const events=getAllSeminars(),store=createMeetingStore(getDb());return {rows:buildHomeRows(events,events.flatMap(event=>store.list(event.id)))};});}
