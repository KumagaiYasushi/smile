import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {resolveSpeakers} from '../lib/speakers.ts';
import {createSocietyMemberStore} from '../lib/society-members.ts';
import {createExternalLecturerStore} from '../lib/external-lecturers.ts';
import {eventSpeakers} from '../types/speaker.ts';
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
    const changed=updateSeminar(event.id,{speakers:[{...event.speakers[1],theme:'変更したテーマ'}]},1);assert.equal(changed.external_lecturer.status,'NO');assert.equal(getSeminarById(event.id).speakers[0].theme,'変更したテーマ');
    assert.throws(()=>db.transaction(()=>createSeminar({...input,event_type:'INVALID',speakers:[{...speakers[0],name:'ロールバック講師'}]},1))());
    assert.ok(!createExternalLecturerStore(db).list().some(p=>p.name==='ロールバック講師'));
    assert.deepEqual(updateSeminar(event.id,{speakers:[]},1).speakers,[]);
  }finally{db.close();rmSync(directory,{recursive:true,force:true});delete process.env.SMILE_DATA_DIR;}
});
