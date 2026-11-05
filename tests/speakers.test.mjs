import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {resolveSpeakers} from '../lib/speakers.ts';
import {createSocietyMemberStore} from '../lib/society-members.ts';
import {createExternalLecturerStore} from '../lib/external-lecturers.ts';
import {eventSpeakers,speakerPaymentSummary,speakerKey,speakerAttendanceWarning} from '../types/speaker.ts';
import {defaultTaskMessage} from '../types/task-message.ts';
test('multiple speaker categories retain independent themes and new external speakers are reusable directory entries',()=>{
  const db=new Database(':memory:');db.exec('CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER);INSERT INTO auth_users VALUES(1,1)');
  try{
    const members=createSocietyMemberStore(db).list();
    const people=[{role:'EXTERNAL_LECTURER',id:null,name:'新しい講師',facility:'テスト病院',theme:'外部講演'},...['SOCIETY_LECTURER','SOCIETY_SUPPORT'].map(role=>({role,id:members.find(p=>p.role===role).id,name:'改ざんされた氏名',facility:'',theme:role+'のテーマ'}))];
    const saved=resolveSpeakers(db,people,[],1);assert.equal(saved.length,3);assert.equal(saved[0].theme,'外部講演');assert.ok(saved[0].id);assert.notEqual(saved[1].name,'改ざんされた氏名');
    assert.equal(createExternalLecturerStore(db).list().filter(p=>p.name==='新しい講師').length,1);
    assert.deepEqual(resolveSpeakers(db,saved,saved,1),saved);
    assert.equal(resolveSpeakers(db,people,saved,1)[0].id,saved[0].id);
    assert.throws(()=>resolveSpeakers(db,[saved[0],saved[0]],saved,1),/重複/);
    assert.throws(()=>resolveSpeakers(db,[{...saved[1],id:999999}],saved,1),/名簿/);
    assert.throws(()=>resolveSpeakers(db,null,[],1));
    assert.deepEqual(eventSpeakers({speakers:[]}),[]);
    assert.equal(eventSpeakers({lecturer_name:'既存講師',lecturer_role:'SOCIETY_LECTURER'})[0].name,'既存講師');
  }finally{db.close();}
});
test('task request text takes precedence over all standard mail defaults and includes individual themes',()=>{
  const event={name:'研究会',dates:[],speakers:[{role:'SOCIETY_SUPPORT',id:1,name:'演者',facility:'',theme:'個別テーマ'}]};
  const task={title:'依頼',description:'指定の依頼文\n提出するのは資料Aのみです。',due_date:'2027-01-01'};
  for(const key of ['invitation','materials','participant_confirmation',undefined]){
    const message=defaultTaskMessage(event,task,key);assert.ok(message.body.includes(task.description));assert.ok(message.body.includes('演者：個別テーマ'));assert.ok(!message.body.includes('1. 略歴'));
  }
});
test('event save persists speakers and directory together; edits preserve data and failed save rolls both back',async()=>{
  const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const directory=mkdtempSync(join(tmpdir(),'smile-speakers-'));process.env.SMILE_DATA_DIR=directory;
  const {getDb,createSeminar,updateSeminar,getSeminarById}=await import('../lib/db.ts');
  const db=getDb();db.exec('CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER);INSERT INTO auth_users VALUES(1,1)');
  const input={event_type:'SEMINAR',occurrence_type:'SINGLE',event_times:{},name:'演者登録',dates:[],content:'',lecturer_name:'',assistant_members:[],fee_dental_hygienist:0,fee_dentist:0,fee_other:0,target_participants:'',venue:'',venue_fee:0,sns_announcement:'',notes:''};
  try{
    const member=createSocietyMemberStore(db).list().find(p=>p.role==='SOCIETY_SUPPORT');
    const speakers=[{role:'EXTERNAL_LECTURER',id:null,name:'保存講師',facility:'保存施設',theme:'テーマA'},{role:member.role,id:member.id,name:member.name,facility:'',theme:'テーマB'}];
    const event=db.transaction(()=>createSeminar({...input,speakers},1))();assert.equal(event.speakers.length,2);assert.equal(event.external_lecturer.id,event.speakers[0].id);
    assert.deepEqual(updateSeminar(event.id,{notes:'変更'},1).speakers,event.speakers);
    const paid=updateSeminar(event.id,{speakers:[{...event.speakers[0],payment:{travel:1000,honorarium:10000}},{...speakers[0],name:'別の外部講師',payment:{travel:2000,honorarium:20000}},event.speakers[1]]},1);
    assert.deepEqual(paid.external_payment,{travel:3000,honorarium:30000});
    assert.deepEqual(getSeminarById(event.id).speakers.slice(0,2).map(p=>p.payment),[{travel:1000,honorarium:10000},{travel:2000,honorarium:20000}]);
    assert.deepEqual(updateSeminar(event.id,{notes:'金額は保持'},1).speakers,paid.speakers);
    for(const payment of [null,{travel:-1,honorarium:0},{travel:1.5,honorarium:0},{travel:'1',honorarium:0}])assert.throws(()=>updateSeminar(event.id,{speakers:[{...paid.speakers[0],payment}]},1),{status:400});
    assert.throws(()=>updateSeminar(event.id,{speakers:[{...paid.speakers[2],payment:{travel:0,honorarium:0}}]},1),{status:400});
    const oldSpeakers=paid.speakers.map(p=>{const legacy={...p};delete legacy.payment;return legacy;});
    db.prepare('UPDATE seminars SET speakers=?,external_payment=? WHERE id=?').run(JSON.stringify(oldSpeakers),JSON.stringify({travel:7000,honorarium:30000}),event.id);
    const legacy=eventSpeakers(getSeminarById(event.id));
    assert.deepEqual(legacy[0].payment,{travel:7000,honorarium:30000});assert.deepEqual(legacy[1].payment,{travel:null,honorarium:null});
    const unrelated=updateSeminar(event.id,{notes:'旧金額を引き継ぐ'},1);assert.deepEqual(eventSpeakers(unrelated),legacy);
    assert.deepEqual(eventSpeakers(getSeminarById(event.id)),legacy);
    const migrated=updateSeminar(event.id,{speakers:legacy},1);assert.deepEqual(migrated.speakers,legacy);
    assert.deepEqual(speakerPaymentSummary(migrated.speakers),{travel:7000,honorarium:30000,travelUnknown:1,honorariumUnknown:1});
    const changed=updateSeminar(event.id,{speakers:[{...event.speakers[1],theme:'変更したテーマ'}]},1);assert.equal(changed.external_lecturer.status,'NO');assert.equal(getSeminarById(event.id).speakers[0].theme,'変更したテーマ');
    assert.throws(()=>db.transaction(()=>createSeminar({...input,event_type:'INVALID',speakers:[{...speakers[0],name:'ロールバック講師'}]},1))());
    assert.ok(!createExternalLecturerStore(db).list().some(p=>p.name==='ロールバック講師'));
    assert.deepEqual(updateSeminar(event.id,{speakers:[]},1).speakers,[]);
    const dates=['2027-06-01','2027-06-08'];
    const sessions=db.transaction(()=>createSeminar({...input,occurrence_type:'MULTIPLE',dates,speakers:[{...speakers[0],date:dates[0],theme:'初回'},{...speakers[0],date:dates[1],theme:'第2回'}]},1))();
    assert.deepEqual(getSeminarById(sessions.id).speakers.map(p=>[p.date,p.theme]),[[dates[0],'初回'],[dates[1],'第2回']]);
    assert.deepEqual(updateSeminar(sessions.id,{notes:'日別演者を保持'},1).speakers,sessions.speakers);
    const edited=updateSeminar(sessions.id,{speakers:sessions.speakers.map((p,i)=>i===1?{...p,theme:'第2回の変更'}:p)},1);assert.equal(edited.speakers[0].theme,'初回');assert.equal(edited.speakers[1].theme,'第2回の変更');
    assert.throws(()=>db.transaction(()=>createSeminar({...input,dates,speakers:[{...speakers[0],date:'2027-07-01'}]},1))(),{status:400});

  }finally{db.close();rmSync(directory,{recursive:true,force:true});delete process.env.SMILE_DATA_DIR;}
});


test('speakers can repeat on different dates with independent themes and payments, but duplicates and unknown dates are refused',()=>{
  const db=new Database(':memory:');db.exec('CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER);INSERT INTO auth_users VALUES(1,1)');
  try{
    const dates=['2027-06-01','2027-06-08'],person={role:'EXTERNAL_LECTURER',id:null,name:'日別の外部講師',facility:'日別施設',theme:'初日のテーマ',date:dates[0],payment:{travel:1000,honorarium:10000}};
    const saved=resolveSpeakers(db,[person,{...person,date:dates[1],theme:'2日目のテーマ',payment:{travel:2000,honorarium:20000}}],[],1,dates);
    assert.equal(saved[0].id,saved[1].id);assert.notEqual(speakerKey(saved[0]),speakerKey(saved[1]));assert.equal(createExternalLecturerStore(db).list().filter(p=>p.name===person.name).length,1);
    assert.deepEqual(speakerPaymentSummary(saved),{travel:3000,honorarium:30000,travelUnknown:0,honorariumUnknown:0});
    assert.deepEqual(resolveSpeakers(db,saved,saved,1,dates),saved);
    const omitted=saved.map(p=>{const next={...p};delete next.payment;return next;});assert.deepEqual(resolveSpeakers(db,omitted,saved,1,dates).map(p=>p.payment),saved.map(p=>p.payment));
    for(const list of [[saved[0],saved[0]],[{...saved[0],date:undefined},saved[1]],[saved[0],{...saved[1],date:undefined}],[{...saved[0],date:'2027-07-01'}],[{...saved[0],date:'invalid'}]])assert.throws(()=>resolveSpeakers(db,list,[],1,dates),{status:400});
    const changedDates=['2027-07-01'];assert.deepEqual(resolveSpeakers(db,saved,saved,1,changedDates),saved);
    db.prepare('UPDATE external_lecturers SET active=0 WHERE id=?').run(saved[0].id);
    assert.equal(resolveSpeakers(db,saved,saved,1,dates).length,2);
    assert.throws(()=>resolveSpeakers(db,[{...saved[0],date:'2027-07-01'}],saved,1,changedDates),{status:400});
    const task={title:'依頼',description:'タスクの依頼文を優先',due_date:null};const message=defaultTaskMessage({name:'日別イベント',dates,speakers:saved},task);
    assert.ok(message.body.includes('2027-06-01 ／ 日別の外部講師：初日のテーマ'));assert.ok(message.body.includes('2027-06-08 ／ 日別の外部講師：2日目のテーマ'));assert.ok(message.body.includes(task.description));
  }finally{db.close();}
});


test('attendance warnings match society speakers on the selected date and all three restricted responses',()=>{
  const speakers=[{role:'SOCIETY_LECTURER',id:1,name:'講師A',facility:'',theme:'',date:'2027-06-01'},{role:'SOCIETY_SUPPORT',id:2,name:'サポートB',facility:'',theme:'',date:'2027-06-08'}];
  for(const response of ['ABSENT','AM_ONLY','PM_ONLY']){
    assert.match(speakerAttendanceWarning(speakers,{member_id:1,name:'講師A',role:'SOCIETY_LECTURER'},'2027-06-01',response),/演者/);
    assert.match(speakerAttendanceWarning(speakers,{member_id:2,name:'サポートB',role:'SOCIETY_SUPPORT'},'2027-06-08',response),/演者/);
    assert.equal(speakerAttendanceWarning(speakers,{member_id:1,name:'講師A',role:'SOCIETY_LECTURER'},'2027-06-08',response),null);
  }
  for(const response of ['ATTENDING','UNANSWERED'])assert.equal(speakerAttendanceWarning(speakers,{member_id:1,name:'講師A',role:'SOCIETY_LECTURER'},'2027-06-01',response),null);
  assert.equal(speakerAttendanceWarning(speakers,{member_id:99,name:'講師A',role:'SOCIETY_LECTURER'},'2027-06-01','ABSENT'),null);
  assert.match(speakerAttendanceWarning(speakers,{name:'講師A',role:'SOCIETY_LECTURER'},'2027-06-01','ABSENT'),/演者/);
});
