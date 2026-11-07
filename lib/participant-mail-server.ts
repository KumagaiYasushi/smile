import {getDb} from '@/lib/db';
import {createParticipantMailStore} from '@/lib/participant-mail';
import {createGmailStore} from '@/lib/gmail';
export async function processParticipantMail(eventId:number){
  // Participant writes succeed even if mail needs later reconciliation or retry.
  try{return await createParticipantMailStore(getDb()).dispatch(eventId,createGmailStore(getDb()),process.env.APP_ORIGIN||'https://smile.invalid');}catch{return {sent:0,pending:1};}
}
