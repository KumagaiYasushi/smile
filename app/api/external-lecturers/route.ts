import {NextRequest} from 'next/server';
import {currentUser,requireMember} from '@/lib/auth-server';
import {participantResponse} from '@/lib/participants-server';
import {getDb} from '@/lib/db';
import {createExternalLecturerStore} from '@/lib/external-lecturers';
import {TaskError} from '@/types/task';
export async function GET(request:NextRequest){const denied=await requireMember(request);if(denied)return denied;return participantResponse(()=>({lecturers:createExternalLecturerStore(getDb()).list()}));}
export async function POST(request:NextRequest){const denied=await requireMember(request);if(denied)return denied;return participantResponse(async()=>{const actor=await currentUser();if(!actor)throw new TaskError('ログインが必要です',401);return createExternalLecturerStore(getDb()).save(await request.json(),actor.id);},201);}
