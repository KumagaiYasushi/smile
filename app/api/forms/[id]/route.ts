import {NextRequest} from 'next/server';
import {participantResponse} from '@/lib/participants-server';
import {getDb,createParticipant} from '@/lib/db';
import {createParticipantMailStore} from '@/lib/participant-mail';
import {processParticipantMail} from '@/lib/participant-mail-server';
import {parseParticipant} from '@/types/participant';
import {parseTaskMail} from '@/types/task-message';
import {parseId,TaskError} from '@/types/task';
export const runtime='nodejs';
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){return participantResponse(async()=>{
  const id=parseId((await params).id),db=getDb(),store=createParticipantMailStore(db);store.authenticate(id,request.headers.get('authorization')?.startsWith('Bearer ')?request.headers.get('authorization')!.slice(7):'');
  if(Number(request.headers.get('content-length')??0)>16384)throw new TaskError('申込内容が大きすぎます',413);const text=await request.text();if(Buffer.byteLength(text)>16384)throw new TaskError('申込内容が大きすぎます',413);const body=JSON.parse(text);
  if(body&&typeof body==='object'&&!Array.isArray(body)&&body.action==='dispatch'&&Object.keys(body).length===1)return processParticipantMail(id);
  if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['response_id','name','role','email','phone','receipt_name'].includes(k))||typeof body.response_id!=='string'||!body.response_id||body.response_id.length>300)throw new TaskError('Googleフォームの申込内容が不正です');
  const {response_id,...fields}=body;const participant=parseParticipant({...fields,payment_status:'unpaid',payment_method:'bank_transfer'});if(!participant.email)throw new TaskError('メールアドレスは必須です');parseTaskMail({to:participant.email,subject:'受付',body:'受付'});
  const result=db.transaction(()=>{const existing=db.prepare('SELECT participant_id FROM participant_form_responses WHERE seminar_id=? AND response_id=?').get(id,response_id) as {participant_id:number|null}|undefined;if(existing){if(!existing.participant_id)throw new TaskError('この回答の参加者は削除されています',410);return {participant_id:existing.participant_id,reused:true};}const created=createParticipant({seminar_id:id,...participant});db.prepare('INSERT INTO participant_form_responses VALUES(?,?,?)').run(id,response_id,created.id);return {participant_id:created.id,reused:false};}).immediate();
  await processParticipantMail(id);return result;
});}
