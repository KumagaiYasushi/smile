import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {createEventRoleStore} from '../lib/event-roles.ts';
import {createStaffRosterStore} from '../lib/staff-roster.ts';
import {emptyRoleAssignments,emptyDayRoles,roleAssignmentSubmission} from '../types/event-roles.ts';
import {createTimetableStore} from '../lib/timetable.ts';
import {parseTimetable,timetableRows,timetableWindow} from '../types/timetable.ts';
const item=(id,type='BREAK',minutes=10)=>({id,type,title:type==='BREAK'?'休憩':'講演',minutes,speaker_key:null,speaker_name:'',theme:''});
const day={date:'2027-06-01',start:'09:30',items:[item('a','OPENING',5),item('b','LECTURE',45),item('c','BREAK',10),item('d','BREAK',5)]};
const event={id:1,dates:['2027-06-01','2027-06-08'],event_times:{'2027-06-01':{start:'09:30',end:'17:00'}},speakers:[{role:'EXTERNAL_LECTURER',id:7,name:'演者A',facility:'勤務先',theme:'基本治療',payment:{travel:1000,honorarium:20000}}]};
function fixture(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY,name TEXT,dates TEXT,lecturer_name TEXT,assistant_members TEXT);INSERT INTO seminars VALUES(1,'架空イベント','[\"2027-06-01\",\"2027-06-08\"]','','[]'),(2,'別イベント','[]','','[]');CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER);INSERT INTO auth_users VALUES(1,1),(2,0)`);return {db,store:createTimetableStore(db)};}
test('times follow durations and ordering, repeated types remain separate and midnight limits are validated',()=>{
  const value=parseTimetable({version:0,days:[day]});assert.equal(value.days[0].items.length,4);
  assert.deepEqual(timetableRows(day).map(p=>[p.start,p.end]),[['09:30','09:35'],['09:35','10:20'],['10:20','10:30'],['10:30','10:35']]);
  assert.equal(timetableRows({...day,items:[day.items[1],day.items[0]]})[1].start,'10:15');
  for(const patch of [{start:'9:00'},{items:[{...item('a'),minutes:0}]},{items:[{...item('a'),minutes:1.5}]},{items:[item('a'),item('a')]},{start:'23:59',items:[item('a')]},{items:[{...item('a'),type:'UNKNOWN'}]}])assert.throws(()=>parseTimetable({version:0,days:[{...day,...patch}]}),{status:400});
  assert.equal(timetableRows({date:null,start:'23:50',items:[item('end')]})[0].end,'翌日 00:00');
});
test('save and reload protect event scope and versions, resolve lectures from registered speakers and preserve old dates',()=>{
  const {db,store}=fixture();try{
    const initial=store.read(event);assert.equal(initial.version,0);assert.equal(initial.days.length,2);assert.equal(initial.days[0].start,'09:30');assert.deepEqual(initial.event_times,event.event_times);assert.equal(initial.lectures[0].key,'EXTERNAL_LECTURER:7');assert.ok(!JSON.stringify(initial).includes('honorarium'));
    const lecture={...item('speaker','LECTURE',30),speaker_key:initial.lectures[0].key,speaker_name:'偽の氏名',theme:'偽のテーマ'};
    const saved=store.save(event,{version:0,days:[{...day,items:[...day.items,lecture]}]},1);assert.equal(saved.version,1);assert.equal(saved.days[0].items.at(-1).speaker_name,'演者A');assert.equal(saved.days[0].items.at(-1).theme,'基本治療');assert.deepEqual(store.read(event),saved);
    assert.throws(()=>store.save(event,{version:0,days:[day]},1),{status:409});assert.equal(store.read(event).version,1);
    assert.throws(()=>store.save(event,{version:1,days:[day]},2),{status:403});
    assert.throws(()=>store.save({...event,id:2},{version:0,days:[{...day,items:[{...lecture,speaker_key:'EXTERNAL_LECTURER:999'}]}]},1),{status:400});
    assert.throws(()=>store.save(event,{version:1,days:[{...day,date:'2027-07-01'}]},1),{status:400});
    const changed={...event,dates:['2027-07-01'],speakers:[]};const old=store.read(changed);assert.equal(old.days[0].date,day.date);assert.ok(old.days.some(p=>p.date==='2027-07-01'));
    const kept=store.save(changed,{version:old.version,days:old.days},1);assert.equal(kept.days[0].items.at(-1).speaker_name,'演者A');
    db.prepare('DELETE FROM seminars WHERE id=1').run();assert.equal(db.prepare('SELECT count(*) n FROM event_timetables').get().n,0);assert.throws(()=>store.read(event),{status:404});
  }finally{db.close();}
});
test('undecided-date events can build a timetable and multiple dates remain independent',()=>{
  const {db,store}=fixture();try{
    const undecided={...event,dates:[]};assert.equal(store.read(undecided).days[0].date,null);
    const saved=store.save(undecided,{version:0,days:[{...day,date:null}]},1);assert.equal(saved.days[0].items.length,4);
    const next=store.read(event);assert.equal(next.days.length,3);assert.equal(next.days[1].items.length,0);assert.equal(next.days[2].items.length,0);
    assert.throws(()=>parseTimetable({version:1,days:[day,day]}),{status:400});
  }finally{db.close();}
});

test('basic lecture time defines the available window and remaining/overrun minutes',()=>{
  const range={start:'09:00',end:'10:30'};
  const fit=timetableWindow(day,range);assert.equal(fit.available,90);assert.equal(fit.remaining,-5);assert.equal(fit.beforeStart,false);
  const early=timetableWindow({...day,start:'08:30'},range);assert.equal(early.beforeStart,true);assert.equal(early.remaining,55);
  assert.equal(timetableWindow(day,{start:'09:00',end:null}).remaining,null);
  assert.equal(timetableWindow(day,undefined).available,null);
  assert.equal(timetableWindow({...day,items:[{...item('empty'),minutes:NaN}]},range).remaining,null);
});


test('lecture chairs come only from that day roles, resolve names, survive reorder and retain historical assignments',()=>{
  const {db,store}=fixture();try{
    const roles=createEventRoleStore(db),initial=roles.read(1),[a,b,c]=initial.members.filter(p=>p.active);
    const person=p=>({member_id:p.id,member_version:p.version});
    roles.save(1,{version:0,assignments:emptyRoleAssignments(),day_assignments:{'2027-06-01':{...emptyDayRoles(),CHAIR:[person(a),person(b)]},'2027-06-08':{...emptyDayRoles(),CHAIR:[person(c)]}}},1);
    const candidates=store.read(event);assert.deepEqual(candidates.chair_choices['2027-06-01'].map(p=>p.member_id),[a.id,b.id]);assert.deepEqual(candidates.chair_choices['2027-06-08'].map(p=>p.member_id),[c.id]);
    const lecture={...item('lecture','LECTURE'),chairs:[{member_id:a.id,name:'偽の氏名'},{member_id:b.id,name:'偽の氏名'}]};
    const saved=store.save(event,{version:0,days:[{...day,items:[lecture,item('break')]}]},1);assert.deepEqual(saved.days[0].items[0].chairs.map(p=>p.name),[a.name,b.name]);
    const reordered=store.save(event,{version:saved.version,days:[{...saved.days[0],items:[saved.days[0].items[1],saved.days[0].items[0]]}]},1);assert.equal(reordered.days[0].items[1].chairs[0].member_id,a.id);
    for(const bad of [{...lecture,chairs:[{member_id:c.id,name:c.name}]},{...lecture,id:'new',chairs:[{member_id:9999,name:'不明'}]},{...lecture,chairs:[{member_id:a.id,name:a.name},{member_id:a.id,name:a.name}]},{...lecture,type:'BREAK'}])assert.throws(()=>store.save(event,{version:reordered.version,days:[{...day,items:[bad]}]},1),{status:400});
    assert.throws(()=>store.save(event,{version:reordered.version,days:[{...day,date:'2027-06-08',items:[lecture]}]},1),{status:400});
    const roster=createStaffRosterStore(db),row=roster.list(1).rows.find(p=>p.member_id===a.id);
    roster.setResponse(1,{member_id:a.id,member_version:a.version,version:row.version,date:'2027-06-01',response:'ABSENT',schedule:event.dates},1);
    assert.ok(!store.read(event).chair_choices['2027-06-01'].some(p=>p.member_id===a.id));
    assert.throws(()=>store.save(event,{version:reordered.version,days:[{...day,items:[{...lecture,id:'another'}]}]},1),{status:400});
    const changedRoles=roles.read(1),removed=roleAssignmentSubmission(changedRoles,changedRoles.members);removed.day_assignments['2027-06-01'].CHAIR=[];roles.save(1,removed,1);
    const historical=store.read(event);assert.equal(historical.days[0].items[1].chairs.length,2);assert.equal(historical.chair_choices['2027-06-01'].length,0);
    const retained=store.save(event,{version:historical.version,days:historical.days},1);assert.equal(retained.days[0].items[1].chairs[0].name,a.name);
    const cleared=store.save(event,{version:retained.version,days:retained.days.map(d=>({...d,items:d.items.map(p=>({...p,chairs:[]}))}))},1);assert.equal(cleared.days[0].items[1].chairs.length,0);
    assert.throws(()=>store.save(event,{version:cleared.version,days:[{...day,items:[lecture]}]},1),{status:400});
    assert.equal(store.read({...event,id:2,dates:[]}).chair_choices[''].length,0);
  }finally{db.close();}
});

test('legacy timetable items default to no chairs and unknown-date chairs use unknown-date roles',()=>{
  const {db,store}=fixture();try{
    db.prepare("UPDATE seminars SET dates='[]' WHERE id=1").run();const undecided={...event,dates:[]};
    db.prepare('INSERT INTO event_timetables(seminar_id,days_json,actor_id) VALUES(?,?,1)').run(1,JSON.stringify([{...day,date:null}]));
    const legacy=store.read(undecided);assert.deepEqual(legacy.days[0].items[1].chairs,[]);
    const roles=createEventRoleStore(db),initial=roles.read(1),member=initial.members[0];roles.save(1,{version:0,assignments:{...emptyRoleAssignments(),CHAIR:[{member_id:member.id,member_version:member.version}]}},1);
    assert.equal(store.read(undecided).chair_choices[''][0].member_id,member.id);
  }finally{db.close();}
});
