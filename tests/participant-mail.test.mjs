import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createParticipantMailStore} from '../lib/participant-mail.ts';
import {createReceiptStore} from '../lib/receipts.ts';
import {TaskError} from '../types/task.ts';
import {participantFormScript} from '../lib/participant-form-script.ts';
const directory=mkdtempSync(join(tmpdir(),'smile-auto-mail-'));process.env.SMILE_DATA_DIR=directory;
const {getDb,createSeminar,createParticipant,updateParticipant,getParticipantById}=await import('../lib/db.ts');
const db=getDb();db.exec('CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER);INSERT INTO auth_users VALUES(1,1),(2,0),(3,1)');
after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});
function fixture(type='BASIC_COURSE'){
  const event=createSeminar({event_type:type,occurrence_type:'SINGLE',event_times:{},name:'自動メールの架空イベント',dates:['2027-06-01'],content:'',lecturer_name:'',assistant_members:[],fee_dental_hygienist:3000,fee_dentist:5000,fee_other:2000,target_participants:'',venue:'架空会議室',venue_fee:0,sns_announcement:'',notes:''},1),store=createParticipantMailStore(db),sent=[];
  const gateway={status:()=>({connected:true,configured:true,email:'organizer@example.invalid'}),request:async(user,path,options)=>{assert.equal(user,1);assert.equal(path,'/messages/send');sent.push(Buffer.from(JSON.parse(options.body).raw,'base64url').toString());return {id:`gmail-${sent.length}`};}};
  function save(patch={},actor=1){const current=store.read(event.id);return store.save(event.id,{settings:{enabled:true,bank_id:1,consultation_url:'https://forms.gle/clinical',homework:type==='BASIC_COURSE'?'症例を1つお持ちください。':'',...patch},version:current.version,banks:current.banks.map(p=>({...p,details:p.id===1?'架空銀行 第一支店 普通 0000000 テスト口座1':'架空銀行 第二支店 普通 1111111 テスト口座2'})),banks_version:current.banks_version},actor,gateway);}
  const person=(patch={})=>createParticipant({seminar_id:event.id,name:'架空参加者',receipt_name:'宛名確認用の医療法人',role:'dental_hygienist',email:'participant@example.invalid',phone:'',payment_status:'unpaid',payment_method:'bank_transfer',paid_amount:null,attended:false,receipt_number:'',notes:'',...patch},1);
  return {event,store,gateway,sent,save,person};
}
function text(mime){const encoded=mime.split('Content-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0];return Buffer.from(encoded.replace(/\r\n/g,''),'base64').toString();}
test('registration mails select one of two banks, omit optional consultation, and include homework only for basic courses',async()=>{
  const f=fixture();f.save({bank_id:2,consultation_url:''});f.person();assert.equal(f.store.read(f.event.id).jobs[0].phase,'QUEUED');await f.store.dispatch(f.event.id,f.gateway,'https://app.example.invalid');assert.equal(f.sent.length,1);const body=text(f.sent[0]);assert.ok(body.includes('お申し込みいただき、誠にありがとうございます'));assert.ok(body.includes('テスト口座2'));assert.ok(!body.includes('テスト口座1'));assert.ok(!body.includes('臨床のお悩み'));assert.ok(body.includes('症例を1つ'));assert.ok(body.includes('3,000円'));
  await f.store.dispatch(f.event.id,f.gateway,'https://app.example.invalid');assert.equal(f.sent.length,1);
  const seminar=fixture('SEMINAR');seminar.save();seminar.person({role:'dentist'});await seminar.store.dispatch(seminar.event.id,seminar.gateway,'https://app.example.invalid');assert.ok(text(seminar.sent[0]).includes('https://forms.gle/clinical'));assert.ok(!text(seminar.sent[0]).includes('事前課題'));assert.ok(text(seminar.sent[0]).includes('5,000円'));assert.throws(()=>seminar.save({homework:'課題'}),/ベーシック/);
});
test('confirming payment automatically queues one immutable PDF receipt with the application receipt addressee',async()=>{
  const f=fixture();f.save();const p=f.person();await f.store.dispatch(f.event.id,f.gateway,'https://app.example.invalid');updateParticipant(p.id,{payment_status:'paid',paid_amount:3000},1);
  await Promise.all([f.store.dispatch(f.event.id,f.gateway,'https://app.example.invalid'),f.store.dispatch(f.event.id,f.gateway,'https://app.example.invalid')]);assert.equal(f.sent.length,2);const mime=f.sent[1];assert.ok(text(mime).includes('ご入金を確認'));assert.ok(mime.includes('Content-Disposition: attachment; filename="receipt.pdf"'));
  const encoded=mime.split('Content-Disposition: attachment; filename="receipt.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0],pdf=Buffer.from(encoded.replace(/\r\n/g,''),'base64');assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>10000);
  const receipt=createReceiptStore(db).get(f.event.id,p.id);assert.equal(receipt.participant_name,'宛名確認用の医療法人');assert.equal(receipt.amount,3000);assert.ok(getParticipantById(p.id).issued_receipt_id);
  updateParticipant(p.id,{notes:'メモの変更'},1);await f.store.dispatch(f.event.id,f.gateway,'https://app.example.invalid');assert.equal(f.sent.length,2);assert.throws(()=>updateParticipant(p.id,{receipt_name:'別の宛名'},1),{status:409});
});
test('ambiguous Gmail results never resend and reconcile only matching sent messages',async()=>{
  const f=fixture();f.save();f.person();let attempts=0;const gateway={...f.gateway,request:async()=>{attempts++;throw new Error('timeout');}};await f.store.dispatch(f.event.id,gateway,'https://app.example.invalid');assert.equal(f.store.read(f.event.id).jobs[0].phase,'UNKNOWN');assert.equal(attempts,1);
  gateway.request=async(user,path)=>{assert.ok(path.startsWith('/messages?'));return {messages:[]};};await f.store.dispatch(f.event.id,gateway,'https://app.example.invalid');assert.equal(f.store.read(f.event.id).jobs[0].phase,'UNKNOWN');assert.equal(attempts,1);
  const job=db.prepare('SELECT * FROM participant_mail_outbox WHERE seminar_id=?').get(f.event.id);gateway.request=async(user,path)=>path.startsWith('/messages?')?{messages:[{id:'found'}]}:{id:'found',labelIds:['SENT'],payload:{headers:[{name:'Message-ID',value:job.message_id},{name:'To',value:job.recipient}]}};
  await f.store.dispatch(f.event.id,gateway,'https://app.example.invalid');assert.equal(f.store.read(f.event.id).jobs[0].phase,'SENT');
});
test('queue and payment writes roll back together; unpaid changes cancel pending receipt delivery',async()=>{
  const f=fixture();f.save();const p=f.person();db.exec("CREATE TRIGGER reject_auto_payment BEFORE INSERT ON participant_mail_outbox WHEN NEW.kind='PAYMENT' BEGIN SELECT RAISE(ABORT,'queue failed');END");assert.throws(()=>updateParticipant(p.id,{payment_status:'paid',paid_amount:3000},1),/queue failed/);assert.equal(getParticipantById(p.id).payment_status,'unpaid');db.exec('DROP TRIGGER reject_auto_payment');
  updateParticipant(p.id,{payment_status:'paid',paid_amount:3000},1);updateParticipant(p.id,{payment_status:'unpaid'},1);await f.store.dispatch(f.event.id,f.gateway,'https://app.example.invalid');assert.equal(f.sent.length,1);assert.equal(f.store.read(f.event.id).jobs.find(p=>p.kind==='PAYMENT').phase,'CANCELLED');assert.throws(()=>createReceiptStore(db).get(f.event.id,p.id),{status:404});
});
test('tokens are scoped, hashed, revocable and require an active owner; stale configuration cannot overwrite shared bank accounts',()=>{
  const f=fixture();f.save();const token=f.store.rotateToken(f.event.id,1);assert.equal(f.store.authenticate(f.event.id,token).owner_id,1);assert.ok(!JSON.stringify(f.store.read(f.event.id)).includes(token));assert.notEqual(db.prepare('SELECT token_hash FROM participant_mail_settings WHERE seminar_id=?').get(f.event.id).token_hash,token);
  const other=fixture();other.save();assert.throws(()=>f.store.authenticate(other.event.id,token),{status:401});f.store.rotateToken(f.event.id,1);assert.throws(()=>f.store.authenticate(f.event.id,token),{status:401});assert.throws(()=>f.save({},3),{status:403});assert.throws(()=>f.save({},2),{status:403});
  const current=f.store.read(f.event.id);assert.throws(()=>f.store.save(f.event.id,{settings:current.settings,version:0,banks:current.banks,banks_version:current.banks_version},1,f.gateway),{status:409});
  assert.throws(()=>f.store.save(f.event.id,{settings:current.settings,version:current.version,banks:current.banks.map(p=>({...p,details:'別の情報'})),banks_version:0},1,f.gateway),{status:409});
  const script=participantFormScript('https://app.example.invalid/api/forms/1','test-token');assert.ok(script.includes('領収書宛名'));assert.ok(script.includes('getRespondentEmail'));assert.ok(script.includes('everyMinutes(5)'));assert.ok(script.includes('response_id'));
});
test('disabled automation does not retroactively mail existing participants, and invalid recipients require correction',async()=>{
  const f=fixture();const old=f.person();assert.equal(f.store.read(f.event.id).jobs.length,0);f.save();assert.equal(f.store.read(f.event.id).jobs.length,0);updateParticipant(old.id,{notes:'変更'},1);assert.equal(f.store.read(f.event.id).jobs.length,0);
  const invalid=f.person({email:''});assert.equal(f.store.read(f.event.id).jobs[0].phase,'BLOCKED');updateParticipant(invalid.id,{email:'corrected@example.invalid'},1);await f.store.dispatch(f.event.id,f.gateway,'https://app.example.invalid');assert.equal(f.sent.length,1);assert.ok(f.sent[0].includes('To: corrected@example.invalid'));
});
test('switching or disconnecting the sender blocks delivery; explicit Gmail rejection remains safely queued',async()=>{
  const f=fixture();f.save();f.person();await f.store.dispatch(f.event.id,{...f.gateway,status:()=>({connected:true,configured:true,email:'different@example.invalid'})},'https://app.example.invalid');assert.equal(f.sent.length,0);assert.equal(f.store.read(f.event.id).jobs[0].phase,'QUEUED');
  await f.store.dispatch(f.event.id,{...f.gateway,request:async()=>{throw new TaskError('denied',424);}},'https://app.example.invalid');assert.equal(f.store.read(f.event.id).jobs[0].phase,'QUEUED');await f.store.dispatch(f.event.id,f.gateway,'https://app.example.invalid');assert.equal(f.sent.length,1);
});


test('revoked credentials before sending remain retryable without duplicating a receipt',async()=>{
  const f=fixture();f.save();const p=f.person();updateParticipant(p.id,{payment_status:'paid',paid_amount:3000},1);
  await f.store.dispatch(f.event.id,{...f.gateway,request:async()=>{throw new TaskError('credentials revoked',409);}},'https://app.example.invalid');
  assert.ok(f.store.read(f.event.id).jobs.every(p=>p.phase==='QUEUED'));const receipt=createReceiptStore(db).get(f.event.id,p.id);await f.store.dispatch(f.event.id,f.gateway,'https://app.example.invalid');assert.equal(f.sent.length,2);assert.equal(createReceiptStore(db).get(f.event.id,p.id).id,receipt.id);
});
