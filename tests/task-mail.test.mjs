import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {createTaskStore} from '../lib/tasks.ts';
import {createTaskMailStore} from '../lib/task-mail.ts';
import {parseTaskMail,defaultTaskMessage} from '../types/task-message.ts';
import {preparationSummary} from '../types/preparation-summary.ts';
import {TaskError} from '../types/task.ts';
const event={id:1,name:'架空の講演会',dates:['2027-06-01'],occurrence_type:'SINGLE',event_times:{},external_lecturer:{name:'架空講師'}};
function fixture(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY);INSERT INTO seminars VALUES(1),(2);CREATE TABLE auth_users(id INTEGER PRIMARY KEY,email TEXT,active INTEGER);INSERT INTO auth_users VALUES(1,'member@example.invalid',1),(2,'other@example.invalid',1),(3,'inactive@example.invalid',0);`);const tasks=createTaskStore(db),mail=createTaskMailStore(db),task=tasks.createTask(1,{title:'講師の資料'},1);return {db,tasks,mail,task};}
const draft={to:'lecturer@example.invalid',subject:'日本語の件名'.repeat(12),body:'依頼本文です。\n略歴・写真・抄録300字・800字をお願いします。'};
test('messages validate headers, recipients, scope and versions; bundled template requests all four documents',()=>{const {db,mail,task}=fixture();try{
  const generated=defaultTaskMessage(event,task,'materials');for(const word of ['略歴','プロフィール写真','抄録300文字','抄録800文字'])assert.ok(generated.body.includes(word));assert.equal(generated.to,'');
  for(const patch of [{to:'a@b.invalid,c@d.invalid'},{to:'bad\r\nBcc:x@y.invalid'},{subject:'a\r\nBcc:x@y.invalid'},{body:''},{owner_id:2}])assert.throws(()=>parseTaskMail({...draft,...patch}),{status:400});
  assert.equal(mail.read(event,task.id).version,0);const saved=mail.save(event,task.id,{...draft,version:0},1);assert.equal(saved.version,1);assert.throws(()=>mail.save(event,task.id,{...draft,version:0},1),{status:409});assert.throws(()=>mail.save({...event,id:2},task.id,{...draft,version:0},1),{status:404});assert.throws(()=>mail.save(event,task.id,{...draft,version:1},3),{status:403});
}finally{db.close();}});
test('Gmail sends exactly once and only a matched, later human reply changes received status and task review state',async()=>{const {db,mail,task,tasks}=fixture();try{
  let raw='',calls=0;const gateway={status:()=>({connected:true,email:'sender@example.invalid'}),request:async(_id,path,options)=>{calls++;if(path==='/messages/send'){raw=Buffer.from(JSON.parse(options.body).raw,'base64url').toString('utf8');return {id:'sent1',threadId:'thread1'};}const rfc=db.prepare('SELECT message_id FROM event_task_mail').get().message_id;return {messages:[{id:'reply1',internalDate:String(Date.now()+1000),labelIds:['INBOX'],payload:{headers:[{name:'From',value:'講師 <lecturer@example.invalid>'},{name:'In-Reply-To',value:rfc}]}}]};}};
  const saved=mail.save(event,task.id,{...draft,version:0},1);const sent=await mail.send(event,task.id,saved.version,1,gateway,'https://app.example.invalid');assert.equal(sent.phase,'SENT');assert.equal(tasks.getTask(1,task.id).status,'IN_PROGRESS');assert.ok(raw.includes('Message-ID: <smile-'));
  const encoded=raw.match(/Subject: ([\s\S]*?)\r\nMessage-ID:/)[1];const decoded=[...encoded.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map(m=>Buffer.from(m[1],'base64').toString('utf8')).join('');assert.equal(decoded,draft.subject);
  await assert.rejects(()=>mail.send(event,task.id,sent.version,1,gateway,'https://app.example.invalid'),{status:409});assert.equal(calls,1);
  assert.equal((await mail.sync(2,gateway)).updated,0);assert.equal((await mail.sync(1,gateway)).updated,1);assert.equal(mail.read(event,task.id).phase,'RECEIVED');assert.equal(tasks.getTask(1,task.id).status,'IN_REVIEW');assert.equal((await mail.sync(1,gateway)).updated,0);
  assert.throws(()=>mail.save(event,task.id,{...draft,version:mail.read(event,task.id).version},1),{status:409});db.prepare('DELETE FROM seminars WHERE id=1').run();assert.equal(db.prepare('SELECT count(*) n FROM event_task_mail').get().n,0);
}finally{db.close();}});
test('unrelated senders, missing reply references, automated replies and drafts do not imply receipt',async()=>{const {db,mail,task}=fixture();try{
  const send={status:()=>({connected:true,email:'sender@example.invalid'}),request:async()=>({id:'sent',threadId:'thread'})};const saved=mail.save(event,task.id,{...draft,version:0},1);await mail.send(event,task.id,saved.version,1,send,'https://app.example.invalid');const rfc=db.prepare('SELECT message_id FROM event_task_mail').get().message_id;
  for(const [from,reference,automatic,labels]of [['stranger@example.invalid',rfc,'no',['INBOX']],['lecturer@example.invalid','<unrelated>','no',['INBOX']],['lecturer@example.invalid',rfc,'auto-replied',['INBOX']],['lecturer@example.invalid',rfc,'no',['DRAFT']]]){const gateway={...send,request:async()=>({messages:[{id:'other',internalDate:String(Date.now()+2000),labelIds:labels,payload:{headers:[{name:'From',value:from},{name:'References',value:reference},{name:'Auto-Submitted',value:automatic}]}}]})};assert.equal((await mail.sync(1,gateway)).updated,0);assert.equal(mail.read(event,task.id).phase,'SENT');}
}finally{db.close();}});
test('ambiguous Gmail outcomes do not retry and reconcile a sent message by its stable RFC Message-ID',async()=>{const {db,mail,task}=fixture();try{
  let sends=0;const gateway={status:()=>({connected:true,email:'sender@example.invalid'}),request:async(_id,path)=>{if(path==='/messages/send'){sends++;throw new TaskError('timeout',502);}if(path.startsWith('/messages?'))return {messages:[{id:'accepted'}]};if(path.startsWith('/messages/'))return {id:'accepted',threadId:'thread'};return {messages:[]};}};
  const saved=mail.save(event,task.id,{...draft,version:0},1);await assert.rejects(()=>mail.send(event,task.id,saved.version,1,gateway,'https://app.example.invalid'),{status:502});assert.equal(mail.read(event,task.id).phase,'UNKNOWN');await assert.rejects(()=>mail.send(event,task.id,mail.read(event,task.id).version,1,gateway,'https://app.example.invalid'),{status:409});assert.equal(sends,1);assert.equal((await mail.sync(1,gateway)).updated,1);assert.equal(mail.read(event,task.id).phase,'SENT');
}finally{db.close();}});
test('preparation comment is short, changes across Japan midnight, reports overdue and mail states, and does not claim unregistered work is complete',()=>{const {db,tasks,task}=fixture();try{
  const updated=tasks.updateTask(1,task.id,{due_date:'2026-11-02'},task.version,1);const before=preparationSummary([updated],[],new Date('2026-11-02T14:59:00Z')),after=preparationSummary([updated],[{task_id:task.id,phase:'RECEIVED'}],new Date('2026-11-02T15:01:00Z'));assert.equal(before.date,'2026-11-02');assert.equal(after.date,'2026-11-03');assert.match(after.text,/期限超過が1件/);assert.match(after.text,/受信済み1件/);assert.ok(after.text.length<250);assert.match(preparationSummary([]).text,/未登録/);
}finally{db.close();}});
test('concurrent sends claim once and a different connected Gmail cannot reconcile old threads',async()=>{const {db,mail,task}=fixture();try{
  let finish;let calls=0;const wait=new Promise(resolve=>{finish=resolve;});const gateway={status:()=>({connected:true,email:'sender@example.invalid'}),request:async()=>{calls++;await wait;return {id:'sent',threadId:'thread'};}};
  const saved=mail.save(event,task.id,{...draft,version:0},1),first=mail.send(event,task.id,saved.version,1,gateway,'https://app.example.invalid');await assert.rejects(()=>mail.send(event,task.id,saved.version,1,gateway,'https://app.example.invalid'),{status:409});finish();await first;assert.equal(calls,1);
  assert.equal((await mail.sync(1,{...gateway,status:()=>({connected:true,email:'other@example.invalid'}),request:async()=>{throw new Error('wrong mailbox queried');}})).updated,0);
}finally{db.close();}});
test('definitive Gmail rejections permit editing and retry, while accepted sends cannot be resubmitted',async()=>{const {db,mail,task}=fixture();try{
  const gateway={status:()=>({connected:true,email:'sender@example.invalid'}),request:async()=>{throw new TaskError('forbidden',424);}};const saved=mail.save(event,task.id,{...draft,version:0},1);await assert.rejects(()=>mail.send(event,task.id,saved.version,1,gateway,'https://app.example.invalid'),{status:424});assert.equal(mail.read(event,task.id).phase,'FAILED');const changed=mail.save(event,task.id,{...draft,subject:'宛先を確認した依頼',version:mail.read(event,task.id).version},1);assert.equal(changed.phase,'DRAFT');const sent=await mail.send(event,task.id,changed.version,1,{...gateway,request:async()=>({id:'accepted',threadId:'thread'})},'https://app.example.invalid');assert.equal(sent.phase,'SENT');
}finally{db.close();}});
test('latest task request can regenerate a template while saved drafts and sent messages remain intact',async()=>{
  const {db,mail,task,tasks}=fixture();try{
    const saved=mail.save(event,task.id,{...draft,version:0},1);
    const changed=tasks.updateTask(1,task.id,{title:'変更した依頼状',description:'最新版の依頼内容のみを使用してください。',due_date:'2027-05-20'},task.version,1);
    const generated=mail.template(event,task.id);assert.ok(generated.body.includes(changed.description));assert.ok(generated.body.includes('2027-05-20'));assert.ok(generated.subject.includes(changed.title));
    assert.deepEqual(mail.read(event,task.id),saved);
    assert.throws(()=>mail.template({...event,id:2},task.id),{status:404});
    const updated=mail.save(event,task.id,{...generated,to:draft.to,version:saved.version},1);
    const gateway={status:()=>({connected:true,email:'sender@example.invalid'}),request:async()=>({id:'sent-template',threadId:'thread-template'})};
    const sent=await mail.send(event,task.id,updated.version,1,gateway,'https://app.example.invalid');
    mail.template(event,task.id);assert.deepEqual(mail.read(event,task.id),sent);
    assert.throws(()=>mail.save(event,task.id,{...generated,to:draft.to,version:sent.version},1),{status:409});
  }finally{db.close();}
});
