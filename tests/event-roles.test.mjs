import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {createEventRoleStore} from '../lib/event-roles.ts';
import {createStaffRosterStore} from '../lib/staff-roster.ts';
import {createSocietyMemberStore} from '../lib/society-members.ts';
import {createEventRegistrationStore} from '../lib/event-registration.ts';
import {EVENT_ROLES,emptyRoleAssignments,emptyDayRoles,parseRoleAssignments,roleAssignmentSubmission} from '../types/event-roles.ts';
import {emptyLunch} from '../types/lunch.ts';
function fixture(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY,name TEXT,dates TEXT,lecturer_name TEXT,assistant_members TEXT);INSERT INTO seminars VALUES(1,'架空イベント','[]','','[]'),(2,'別イベント','[]','','[]');CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER);INSERT INTO auth_users VALUES(1,1),(2,0);`);const store=createEventRoleStore(db),directory=createSocietyMemberStore(db),members=directory.list();const lecturer=members.find(p=>p.role==='SOCIETY_LECTURER'),support=members.find(p=>p.role==='SOCIETY_SUPPORT');const person=p=>({member_id:p.id,member_version:p.version});const input={version:0,assignments:Object.fromEntries(Object.keys(EVENT_ROLES).map(key=>[key,[person(lecturer),person(support)]]))};return {db,store,members,lecturer,support,person,input};}
test('all ten event roles support multiple directory members and concurrent roles, with independent event scope and no defaults',()=>{const {db,store,input,lecturer,support}=fixture();try{const before=store.read(1);assert.equal(before.version,0);assert.deepEqual(before.assignments,emptyRoleAssignments());assert.equal(db.prepare('SELECT count(*) n FROM event_role_assignments').get().n,0);const saved=store.save(1,input,1);assert.equal(saved.version,1);for(const key of Object.keys(EVENT_ROLES)){assert.equal(saved.assignments[key].length,2);assert.deepEqual(saved.assignments[key].map(p=>p.name),[lecturer.name,support.name]);}assert.equal(store.read(2).version,0);assert.throws(()=>store.read(999),{status:404});const history=db.prepare('SELECT before_json,after_json FROM event_role_history').get();assert.ok(!JSON.stringify(history).includes(lecturer.name));assert.ok(!JSON.stringify(history).includes(support.name));db.prepare('DELETE FROM seminars WHERE id=1').run();assert.equal(db.prepare('SELECT count(*) n FROM event_role_assignments').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM event_role_history').get().n,0);}finally{db.close();}});
test('role assignments validate role keys, member IDs and versions, reject forged snapshots and stale edits',()=>{const {db,store,input,lecturer,person}=fixture();try{
  const invalid=[null,[],{...input,actor_id:1},{...input,version:-1},{...input,version:0.5},{...input,assignments:{VENUE:[]}},{...input,assignments:{...input.assignments,WRONG:[]}},{...input,assignments:{...input.assignments,VENUE:[person(lecturer),person(lecturer)]}},{...input,assignments:{...input.assignments,VENUE:[{...person(lecturer),name:'偽の氏名'}]}},{...input,assignments:{...input.assignments,VENUE:[{member_id:'1',member_version:1}]}}];for(const value of invalid)assert.throws(()=>parseRoleAssignments(value),{status:400});
  assert.throws(()=>store.save(1,input,2),{status:403});const saved=store.save(1,input,1);assert.throws(()=>store.save(1,input,1),{status:409});const changed=roleAssignmentSubmission(saved,saved.members);changed.assignments.VENUE=[];store.save(1,changed,1);assert.equal(store.read(1).assignments.VENUE.length,0);assert.equal(store.read(1).assignments.CHAIR.length,2);
}finally{db.close();}});
test('directory renaming and archiving preserve saved names; new or newly assigned archived and stale candidates are refused',()=>{const {db,store,input,lecturer,support,person}=fixture();try{
  const first={...input,assignments:{...emptyRoleAssignments(),VENUE:[person(lecturer)]}};const saved=store.save(1,first,1);db.prepare('UPDATE society_members SET name=?,active=0,version=version+1 WHERE id=?').run('改名後の氏名',lecturer.id);
  const retained=store.save(1,roleAssignmentSubmission(saved,store.read(1).members),1);assert.equal(retained.assignments.VENUE[0].name,lecturer.name);assert.equal(retained.assignments.VENUE[0].role,'SOCIETY_LECTURER');
  const another=roleAssignmentSubmission(retained,retained.members);another.day_assignments[''].CHAIR=[{member_id:lecturer.id,member_version:2}];assert.throws(()=>store.save(1,another,1),{status:400});
  db.prepare('UPDATE society_members SET version=version+1 WHERE id=?').run(support.id);const stale=roleAssignmentSubmission(retained,retained.members);stale.assignments.LUNCH=[person(support)];assert.throws(()=>store.save(1,stale,1),{status:409});
  const unknown=roleAssignmentSubmission(retained,retained.members);unknown.assignments.LUNCH=[{member_id:9999,member_version:1}];assert.throws(()=>store.save(1,unknown,1),{status:400});
}finally{db.close();}});
test('role and audit failures roll back event edits, lunch and assignments in one registration transaction',()=>{const {db,store,input}=fixture();try{const registration=createEventRegistrationStore(db);const changes={schedule:[],attendance:[],lunch:[{action:'create',data:{...emptyLunch(),quantity:2,unit_price:500}}],roles:input};db.exec("CREATE TRIGGER reject_role_audit BEFORE INSERT ON event_role_history BEGIN SELECT RAISE(ABORT,'audit failed');END");assert.throws(()=>registration.save(()=>{db.prepare('UPDATE seminars SET name=? WHERE id=1').run('失敗する改名');return {id:1};},changes,1),/audit failed/);assert.equal(db.prepare('SELECT name FROM seminars WHERE id=1').get().name,'架空イベント');for(const table of ['event_role_assignments','event_role_history','event_lunch_plans','event_lunch_history'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);db.exec('DROP TRIGGER reject_role_audit');registration.save(()=>({id:1}),changes,1);assert.equal(store.read(1).assignments.VENUE.length,2);assert.equal(db.prepare('SELECT count(*) n FROM event_lunch_plans').get().n,1);const create=()=>{const r=db.prepare("INSERT INTO seminars(name,dates,lecturer_name,assistant_members) VALUES('取り消す登録','[]','','[]')").run();return {id:Number(r.lastInsertRowid)};};assert.throws(()=>registration.save(create,{...changes,roles:{...input,version:99}},1),{status:409});assert.equal(db.prepare('SELECT count(*) n FROM seminars').get().n,2);}finally{db.close();}});

test('absence blocks only that date and preparation roles remain assignable; event registration validates after attendance',()=>{
  const {db,store,lecturer,person}=fixture();try{
    const dates=['2027-06-01','2027-06-08'];db.prepare('UPDATE seminars SET dates=? WHERE id=1').run(JSON.stringify(dates));
    const roster=createStaffRosterStore(db);
    function answer(date,response){const row=roster.list(1).rows.find(p=>p.member_id===lecturer.id);roster.setResponse(1,{member_id:row.member_id,member_version:row.member_version,version:row.version,date,response,schedule:dates},1);}
    answer(dates[0],'ABSENT');answer(dates[1],'ATTENDING');
    const initial=store.read(1);assert.equal(initial.attendance.rows.find(p=>p.member_id===lecturer.id).responses[dates[0]],'ABSENT');
    const payload={version:0,assignments:{...emptyRoleAssignments(),VENUE:[person(lecturer)]},day_assignments:{[dates[0]]:emptyDayRoles(),[dates[1]]:{...emptyDayRoles(),RECEPTION:[person(lecturer)]}}};
    const saved=store.save(1,payload,1);assert.equal(saved.assignments.VENUE.length,1);assert.equal(saved.day_assignments[dates[0]].RECEPTION.length,0);assert.equal(saved.day_assignments[dates[1]].RECEPTION.length,1);
    const denied=roleAssignmentSubmission(saved,saved.members);denied.day_assignments[dates[0]].MC=[person(lecturer)];assert.throws(()=>store.save(1,denied,1),{status:400});assert.equal(store.read(1).version,saved.version);
    const another=roleAssignmentSubmission(saved,saved.members);another.day_assignments[dates[1]].CHAIR=[person(lecturer)];assert.equal(store.save(1,another,1).day_assignments[dates[1]].CHAIR.length,1);
    const unknown=roleAssignmentSubmission(store.read(1),saved.members);unknown.day_assignments['2027-09-01']=emptyDayRoles();assert.throws(()=>store.save(1,unknown,1),{status:400});
    const registration=createEventRegistrationStore(db),row=roster.list(1).rows.find(p=>p.member_id===lecturer.id),latest=store.read(1);
    assert.throws(()=>registration.save(()=>({id:1}),{schedule:dates,attendance:[{member_id:row.member_id,member_version:row.member_version,version:row.version,responses:{[dates[1]]:'ABSENT'}}],lunch:[],roles:roleAssignmentSubmission(latest,latest.members)},1),{status:400});
    assert.equal(roster.list(1).rows.find(p=>p.member_id===lecturer.id).responses[dates[1]],'ATTENDING');
  }finally{db.close();}
});
test('legacy shared day roles migrate to each date once; new dates do not silently inherit roles',()=>{
  const {db,store,input}=fixture();try{
    const dates=['2027-06-01','2027-06-08'];db.prepare('UPDATE seminars SET dates=? WHERE id=1').run(JSON.stringify(dates));
    const saved=store.save(1,input,1);db.prepare('UPDATE event_role_assignments SET day_assignments_json=NULL WHERE seminar_id=1').run();
    const old=store.read(1);assert.equal(old.day_assignments[dates[0]].MC.length,2);assert.equal(old.day_assignments[dates[1]].MC.length,2);
    const migrated=store.save(1,roleAssignmentSubmission(old,old.members),1);assert.equal(migrated.version,saved.version+1);
    db.prepare('UPDATE seminars SET dates=? WHERE id=1').run(JSON.stringify([...dates,'2027-06-15']));
    const extended=store.read(1);assert.equal(extended.day_assignments['2027-06-15'].MC.length,0);assert.equal(extended.day_assignments[dates[1]].MC.length,2);
    const malformed=roleAssignmentSubmission(extended,extended.members);malformed.day_assignments[dates[0]]={MC:[]};assert.throws(()=>parseRoleAssignments(malformed),{status:400});
  }finally{db.close();}
});
