import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createMailHistoryStore} from '../lib/mail-history.ts';
import {createParticipantMailStore} from '../lib/participant-mail.ts';
import {createTaskStore} from '../lib/tasks.ts';
import {createTaskMailStore} from '../lib/task-mail.ts';
const sample=(patch={})=>({source:'TASK',source_id:1,event_id:1,event_name:'送信時のイベント名',kind:'TASK',recipient:'person@example.invalid',recipient_name:'送信先の名前',sender:'sender@example.invalid',subject:'依頼の件名',body:'送った本文\nhttps://example.invalid/',message_id:'<sent-1@example.invalid>',owner_id:1,started_at:'2027-06-01T00:00:00Z',...patch});
function fixture(){const db=new Database(':memory:');db.exec("CREATE TABLE seminars(id INTEGER PRIMARY KEY,name TEXT);INSERT INTO seminars VALUES(1,'イベント1'),(2,'イベント2')");return {db,store:createMailHistoryStore(db)};}
function sent(store,snapshot,time=snapshot.started_at){store.capture(snapshot);store.confirm(snapshot.source,snapshot.source_id,snapshot.message_id,time,'gmail-id');}
test('all mail kinds sort by actual chronology across time zones and support event, kind and literal searches',()=>{
  const {db,store}=fixture();try{
    sent(store,sample());sent(store,sample({source:'PARTICIPANT',source_id:1,event_id:2,kind:'APPLICATION',subject:'受付 100%',message_id:'<sent-2>',started_at:'2027-06-01T10:00:00+09:00'}));sent(store,sample({source:'PARTICIPANT',source_id:2,kind:'PAYMENT',message_id:'<sent-3>',started_at:'2027-06-01T00:30:00Z',attachment_pdf:Buffer.from('retained PDF')}));
    assert.deepEqual(store.list().items.map(p=>p.kind),['APPLICATION','PAYMENT','TASK']);assert.deepEqual(store.list({order:'asc'}).items.map(p=>p.kind),['TASK','PAYMENT','APPLICATION']);assert.equal(store.list({event_id:1}).total,2);assert.equal(store.list({kind:'PAYMENT'}).total,1);assert.equal(store.list({search:'%'}).total,1);assert.equal(store.list({search:'送信先の名前'}).total,3);assert.equal(store.list({search:"' OR 1=1--"}).total,0);assert.ok(store.list().items.every(p=>!Object.hasOwn(p,'body')&&!Object.hasOwn(p,'attachment_pdf')));
    for(const input of [{page:0},{page:-1},{kind:'INVALID'},{event_id:-1},{order:'sideways'},{search:'x'.repeat(201)}])assert.throws(()=>store.list(input),{status:400});
  }finally{db.close();}
});
test('sent snapshots and attachments remain immutable after source changes or deletion',()=>{
  const {db,store}=fixture();try{
    const snapshot=sample({attachment_pdf:Buffer.from('original attachment')});sent(store,snapshot);const id=store.list().items[0].id;store.capture({...snapshot,body:'後から変更',event_name:'変更後の名前',message_id:'<different>'});store.failed('TASK',1,snapshot.message_id,false);assert.equal(store.detail(id).body,snapshot.body);
    db.prepare('DELETE FROM seminars WHERE id=1').run();const saved=store.detail(id);assert.equal(saved.event_name,snapshot.event_name);assert.equal(saved.event_exists,false);assert.equal(store.attachment(id).pdf.toString(),'original attachment');assert.equal(store.list().total,1);assert.throws(()=>store.detail(999),{status:404});
  }finally{db.close();}
});
test('stable pagination covers the whole history without imposing a last-100-message cap',()=>{
  const {db,store}=fixture();try{
    for(let i=1;i<=125;i++)sent(store,sample({source_id:i,message_id:`<${i}>`}));const first=store.list({page:1}),second=store.list({page:2}),third=store.list({page:3});assert.equal(first.total,125);assert.equal(first.items.length,50);assert.equal(second.items.length,50);assert.equal(third.items.length,25);assert.equal(new Set([...first.items,...second.items,...third.items].map(p=>p.id)).size,125);assert.equal(store.list({order:'asc'}).items[0].id,third.items.at(-1).id);
  }finally{db.close();}
});
test('unknown delivery is excluded, checked through the original Gmail, and never resent after source deletion',async()=>{
  const {db,store}=fixture();try{
    const snapshot=sample({started_at:'2020-01-01T00:00:00Z'});store.capture(snapshot);store.failed('TASK',1,snapshot.message_id,false);assert.equal(store.list().total,0);assert.equal(store.list().pending_count,1);db.prepare('DELETE FROM seminars WHERE id=1').run();let calls=0;
    const gateway={status:()=>({connected:true,email:snapshot.sender}),request:async(actor,path)=>{calls++;assert.equal(actor,1);assert.notEqual(path,'/messages/send');return path.startsWith('/messages?')?{messages:[{id:'confirmed'}]}:{id:'confirmed',labelIds:['SENT'],payload:{headers:[{name:'Message-ID',value:snapshot.message_id},{name:'To',value:snapshot.recipient}]}};}};
    assert.equal((await store.sync(1,{...gateway,status:()=>({connected:true,email:'different@example.invalid'})})).updated,0);assert.equal(calls,0);assert.equal((await store.sync(1,gateway)).updated,1);assert.equal(store.list().total,1);assert.equal(store.list().pending_count,0);assert.equal(store.detail(store.list().items[0].id).event_exists,false);
  }finally{db.close();}
});
test('legacy confirmed task messages backfill once; drafts and uncertain messages are not labeled sent',()=>{
  const {db,store}=fixture();try{
    db.exec("CREATE TABLE event_task_mail(task_id INTEGER PRIMARY KEY,seminar_id INTEGER,recipient TEXT,sender TEXT,subject TEXT,body TEXT,phase TEXT,sent_at TEXT,started_at TEXT,message_id TEXT,owner_id INTEGER,gmail_id TEXT)");
    const insert=db.prepare('INSERT INTO event_task_mail VALUES(?,1,?,?,?,?,?,?,?,?,?,?)');insert.run(1,'old@example.invalid','sender@example.invalid','旧件名','旧本文','SENT','2027-01-01T00:00:00Z','2027-01-01T00:00:00Z','<old>',1,'old-id');insert.run(2,'draft@example.invalid','','未送信','下書き','DRAFT',null,null,null,1,null);
    assert.equal(store.list().total,1);assert.equal(store.list().total,1);assert.equal(store.detail(store.list().items[0].id).body,'旧本文');db.prepare('DELETE FROM event_task_mail').run();assert.equal(store.list().total,1);
  }finally{db.close();}
});
test('actual task, application and payment sends create one archive and preserve the sent receipt PDF',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'smile-mail-history-'));process.env.SMILE_DATA_DIR=directory;const {getDb,createSeminar,createParticipant,updateParticipant,deleteParticipant}=await import('../lib/db.ts');const db=getDb();
  try{db.exec("CREATE TABLE auth_users(id INTEGER PRIMARY KEY,email TEXT,active INTEGER);INSERT INTO auth_users VALUES(1,'sender@example.invalid',1)");
    const event=createSeminar({name:'送信履歴のイベント',event_type:'SEMINAR',occurrence_type:'SINGLE',dates:[],event_times:{},content:'',lecturer_name:'',assistant_members:[],fee_dental_hygienist:3000,fee_dentist:5000,fee_other:0,target_participants:'',venue:'',venue_fee:0,sns_announcement:'',notes:''},1),mail=createParticipantMailStore(db),config=mail.read(event.id);let calls=0;
    const gateway={status:()=>({configured:true,connected:true,email:'sender@example.invalid'}),request:async(actor,path)=>{assert.equal(path,'/messages/send');calls++;return {id:`gmail-${calls}`,threadId:`thread-${calls}`};}};
    mail.save(event.id,{settings:{enabled:true,bank_id:1,consultation_url:'',homework:''},version:0,banks:config.banks.map(p=>({...p,details:'架空の口座'})),banks_version:config.banks_version},1,gateway);
    const participant=createParticipant({seminar_id:event.id,name:'参加者',receipt_name:'宛名の医療法人',role:'dental_hygienist',email:'participant@example.invalid',phone:'',payment_status:'unpaid',payment_method:'bank_transfer',paid_amount:null,attended:false,receipt_number:'',notes:''},1);await mail.dispatch(event.id,gateway,'https://app.example.invalid');updateParticipant(participant.id,{payment_status:'paid',paid_amount:3000},1);await mail.dispatch(event.id,gateway,'https://app.example.invalid');
    const tasks=createTaskStore(db),task=tasks.createTask(event.id,{title:'依頼タスク'},1),taskMail=createTaskMailStore(db),saved=taskMail.save(event,task.id,{version:0,to:'lecturer@example.invalid',subject:'依頼',body:'送信する依頼文'},1);await taskMail.send(event,task.id,saved.version,1,gateway,'https://app.example.invalid');
    const history=createMailHistoryStore(db),items=history.list().items;assert.equal(items.length,3);assert.deepEqual(new Set(items.map(p=>p.kind)),new Set(['TASK','APPLICATION','PAYMENT']));const payment=items.find(p=>p.kind==='PAYMENT'),pdf=history.attachment(payment.id).pdf;assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.equal(calls,3);
    deleteParticipant(participant.id);db.prepare('DELETE FROM seminars WHERE id=?').run(event.id);assert.equal(history.list().total,3);assert.equal(history.attachment(payment.id).pdf.compare(pdf),0);assert.ok(history.list().items.every(p=>!p.event_exists));
  }finally{db.close();rmSync(directory,{recursive:true,force:true});}
});
