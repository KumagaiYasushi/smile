import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {createMeetingStore} from '../lib/meetings.ts';
import {createEventRegistrationStore} from '../lib/event-registration.ts';
import {meetingSubmission} from '../types/meeting.ts';
import {parseExternalPayment} from '../types/external-payment.ts';
import {buildHomeRows} from '../types/home.ts';
function fixture(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY,name TEXT,dates TEXT,lecturer_name TEXT,assistant_members TEXT);INSERT INTO seminars VALUES(1,'架空イベント','[]','','[]'),(2,'別イベント','[]','','[]');CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER);INSERT INTO auth_users VALUES(1,1),(2,0)`);const store=createMeetingStore(db),data=store.data(1);const member=data.members[0];const input={title:'事前打ち合わせ',date:'2027-06-01',time:null,method:'ONLINE',attendees:[{member_id:member.id,member_version:member.version,response:'AM_ONLY'}]};return {db,store,input};}
test('meetings keep independent dates/methods/attendance; revisions, scope and directory snapshots protect records',()=>{
  const {db,store,input}=fixture();try{
    let result=store.apply(1,[{action:'create',data:input},{action:'create',data:{...input,date:'2027-06-08',method:'OTHER',attendees:input.attendees.map(p=>({...p,response:'PM_ONLY'}))}}],1);
    assert.equal(result.meetings.length,2);assert.equal(result.meetings[0].attendees[0].response,'AM_ONLY');assert.equal(result.meetings[1].attendees[0].response,'PM_ONLY');
    let first=result.meetings[0];assert.ok(first.attendees[0].name);
    assert.throws(()=>store.apply(2,[{action:'delete',id:first.id,version:first.version}],1),{status:404});
    result=store.apply(1,[{action:'update',id:first.id,version:first.version,data:{...meetingSubmission(first),time:'10:30'}}],1);
    assert.equal(result.meetings[0].version,2);assert.equal(result.meetings[1].version,1);
    assert.throws(()=>store.apply(1,[{action:'update',id:first.id,version:1,data:input}],1),{status:409});
    first=result.meetings[0];const originalName=first.attendees[0].name;
    db.prepare('UPDATE society_members SET name=?,version=version+1 WHERE id=?').run('名簿改名',input.attendees[0].member_id);
    assert.throws(()=>store.apply(1,[{action:'update',id:first.id,version:first.version,data:input}],1),{status:409});
    store.apply(1,[{action:'update',id:first.id,version:first.version,data:{...input,attendees:input.attendees.map(p=>({...p,member_version:p.member_version+1}))}}],1);
    assert.equal(store.list(1)[0].attendees[0].name,originalName);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM event_meeting_history').all()).includes(originalName));
    db.prepare('DELETE FROM seminars WHERE id=1').run();assert.equal(db.prepare('SELECT count(*) n FROM event_meetings').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM event_meeting_history').get().n,0);
  }finally{db.close();}
});
test('invalid inputs, stale batches and audit failures roll back events and every meeting change',()=>{
  const {db,store,input}=fixture();try{
    for(const patch of [{date:'2027-02-30'},{time:'24:00'},{date:null,time:'10:00'},{method:'HYBRID'},{attendees:[...input.attendees,...input.attendees]},{actor_id:1}])assert.throws(()=>meetingSubmission({...input,...patch}),{status:400});
    assert.throws(()=>store.apply(1,[{action:'create',data:input}],2),{status:403});
    const first=store.apply(1,[{action:'create',data:input}],1).meetings[0];
    const batch=[{action:'create',data:input},{action:'delete',id:first.id,version:99}];assert.throws(()=>store.apply(1,batch,1),{status:409});assert.equal(store.list(1).length,1);
    const registration=createEventRegistrationStore(db);
    assert.throws(()=>registration.save(()=>{db.prepare('UPDATE seminars SET name=? WHERE id=1').run('戻す名称');return {id:1};},{schedule:[],attendance:[],lunch:[],meetings:batch},1),{status:409});assert.equal(db.prepare('SELECT name FROM seminars WHERE id=1').get().name,'架空イベント');
    db.exec("CREATE TRIGGER fail_meeting_history BEFORE INSERT ON event_meeting_history BEGIN SELECT RAISE(ABORT,'audit failed'); END");
    assert.throws(()=>store.apply(1,[{action:'delete',id:first.id,version:first.version}],1),/audit failed/);assert.equal(store.list(1).length,1);
  }finally{db.close();}
});
test('HOME orders event dates and meeting dates separately, including other events and undated rows',()=>{
  const events=[{id:1,name:'講演会',event_type:'LECTURE',dates:['2027-06-10'],event_times:{}},{id:2,name:'その他の予定',event_type:'OTHER',dates:[],event_times:{}}];
  const rows=buildHomeRows(events,[{id:3,seminar_id:1,title:'打ち合わせ',date:'2027-06-01',time:'10:00'}]);
  assert.deepEqual(rows.map(p=>p.kind),['MEETING','LECTURE','OTHER']);assert.equal(rows[0].event_name,'講演会');assert.equal(rows[2].date,null);
});
test('external lecturer amounts distinguish unknown/zero and reject negative, fractional and forged values',()=>{
  assert.deepEqual(parseExternalPayment({travel:0,honorarium:null}),{travel:0,honorarium:null});
  for(const value of [null,{},[],{travel:-1,honorarium:100},{travel:100,honorarium:1.5},{travel:'100',honorarium:0},{travel:0,honorarium:0,actor_id:1}])assert.throws(()=>parseExternalPayment(value),{status:400});
});
