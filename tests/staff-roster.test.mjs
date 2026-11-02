import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {createStaffRosterStore} from '../lib/staff-roster.ts';
import {createStaffAttendanceStore} from '../lib/staff-attendance.ts';
import {createSocietyMemberStore} from '../lib/society-members.ts';
import {rosterColor} from '../types/staff-roster.ts';
const dates=['2027-06-01','2027-06-08'];
function fixture() {
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY,name TEXT,dates TEXT,lecturer_name TEXT,assistant_members TEXT);
    CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER); INSERT INTO auth_users VALUES(1,1),(2,0);
    CREATE TABLE participants(id INTEGER PRIMARY KEY,attended INTEGER); INSERT INTO participants VALUES(1,0);`);
  for(const id of [1,2])db.prepare('INSERT INTO seminars VALUES(?,?,?,?,?)').run(id,'架空イベント',JSON.stringify(dates),'','[]');
  return {db,store:createStaffRosterStore(db),staff:createStaffAttendanceStore(db),directory:createSocietyMemberStore(db)};
}
const input=(row,extra={})=>({member_id:row.member_id,member_version:row.member_version,version:row.version,date:dates[0],response:'ATTENDING',schedule:dates,...extra});
test('morning and afternoon attendance persist per date with green rows and keep other answers',()=>{
  const {db,store,staff}=fixture();try{
    const row=store.list(1).rows[0];
    let saved=store.setResponse(1,input(row,{response:'AM_ONLY'}),1);
    saved=store.setResponse(1,input(saved.roster.rows[0],{date:dates[1],response:'PM_ONLY'}),1);
    assert.deepEqual(staff.get(1,saved.person.id).responses,{[dates[0]]:'AM_ONLY',[dates[1]]:'PM_ONLY'});
    assert.match(rosterColor('AM_ONLY'),/text-green-700/);assert.match(rosterColor('PM_ONLY'),/text-green-700/);
    assert.deepEqual(staff.history(1)[0].after.responses,saved.person.responses);
  }finally{db.close();}
});
test('full directory starts unregistered without creating attendance; colors have green, gray and black states',()=>{
  const {db,store,staff}=fixture();try{
    const roster=store.list(1);assert.equal(roster.rows.length,10);assert.ok(roster.rows.every(p=>p.version===0&&p.person_id===null));
    assert.equal(staff.list(1).people.length,0);assert.equal(staff.history(1).length,0);
    assert.match(rosterColor('ATTENDING'),/text-green-700/);assert.match(rosterColor('ABSENT'),/text-slate-500/);assert.match(rosterColor('UNANSWERED'),/text-black/);
    assert.equal(db.prepare('SELECT attended FROM participants').get().attended,0);
  }finally{db.close();}
});
test('radio saves are scoped by event and date; existing plans are adopted and other/old dates stay intact',()=>{
  const {db,store,staff}=fixture();try{
    let row=store.list(1).rows[0];
    const existing=staff.create(1,{name:row.name,role:row.role,schedule:dates,responses:{[dates[0]]:'TENTATIVE',[dates[1]]:'ABSENT'}},1);
    row=store.list(1).rows[0];assert.equal(row.person_id,existing.id);
    let saved=store.setResponse(1,input(row),1);assert.equal(saved.person.id,existing.id);
    assert.equal(saved.person.responses[dates[1]],'ABSENT');
    assert.equal(store.list(2).rows[0].person_id,null);
    row=saved.roster.rows[0];saved=store.setResponse(1,input(row,{date:dates[1],response:'ATTENDING'}),1);
    assert.equal(saved.person.responses[dates[0]],'ATTENDING');
    row=saved.roster.rows[0];saved=store.setResponse(1,input(row,{response:'UNANSWERED'}),1);
    assert.equal(saved.person.responses[dates[0]],'UNANSWERED');assert.equal(saved.person.responses[dates[1]],'ATTENDING');
    db.prepare('UPDATE seminars SET dates=? WHERE id=1').run('["2027-07-01"]');
    row=store.list(1).rows[0];saved=store.setResponse(1,input(row,{date:'2027-07-01',schedule:['2027-07-01'],response:'ABSENT'}),1);
    assert.equal(saved.person.responses[dates[1]],'ATTENDING');assert.equal(saved.person.responses['2027-07-01'],'ABSENT');
    assert.equal(staff.list(1).people.length,1);assert.equal(staff.history(1)[0].actor_id,1);
  }finally{db.close();}
});
test('stale directory, staff versions, schedules, unknown fields and inactive actors never overwrite attendance',()=>{
  const {db,store,directory,staff}=fixture();try{
    let row=store.list(1).rows[0];const original=input(row);
    const saved=store.setResponse(1,original,1);assert.throws(()=>store.setResponse(1,original,1),{status:409});
    row=saved.roster.rows[0];
    for(const extra of [{actor_id:2},{member_id:0},{date:'2027-06-02'},{response:'TENTATIVE'},{response:'toString'}])assert.throws(()=>store.setResponse(1,input(row,extra),1),{status:400});
    assert.throws(()=>store.setResponse(1,input(row,{schedule:[]}),1),{status:409});
    assert.throws(()=>store.setResponse(1,input(row),2),{status:403});
    directory.save({name:'改名',role:row.role,active:true,version:row.member_version},1,row.member_id);
    assert.throws(()=>store.setResponse(1,input(row),1),{status:409});
    assert.equal(staff.get(1,saved.person.id).version,saved.person.version);
  }finally{db.close();}
});
test('linked registrations survive directory renaming and archival; deleted attendance resets to unregistered',()=>{
  const {db,store,staff,directory}=fixture();try{
    const row=store.list(1).rows[0],saved=store.setResponse(1,input(row),1);
    directory.save({name:'新しい氏名',role:row.role,active:false,version:row.member_version},1,row.member_id);
    const renamed=store.list(1).rows.find(p=>p.member_id===row.member_id);
    assert.equal(renamed.person_id,saved.person.id);assert.equal(renamed.name,row.name);assert.equal(renamed.directory_name,'新しい氏名');assert.equal(renamed.active,false);
    assert.equal(store.list(2).rows.some(p=>p.member_id===row.member_id),false);
    staff.remove(1,saved.person.id,{version:saved.person.version},1);
    assert.equal(db.prepare('SELECT count(*) n FROM event_staff_directory_links').get().n,0);
    assert.equal(store.list(1).rows.some(p=>p.member_id===row.member_id),false);
  }finally{db.close();}
});
test('radio/link writes roll back on failure, and undated events use their own unregistered state',()=>{
  const {db,store,staff}=fixture();try{
    const row=store.list(1).rows[0];
    db.exec("CREATE TRIGGER fail_link BEFORE INSERT ON event_staff_directory_links BEGIN SELECT RAISE(ABORT,'link unavailable'); END");
    assert.throws(()=>store.setResponse(1,input(row),1),/link unavailable/);assert.equal(staff.list(1).people.length,0);assert.equal(staff.history(1).length,0);
    db.exec('DROP TRIGGER fail_link');db.prepare('UPDATE seminars SET dates=? WHERE id=1').run('[]');
    const saved=store.setResponse(1,input(store.list(1).rows[0],{date:'',schedule:[]}),1);
    assert.equal(saved.person.responses[''],'ATTENDING');
    db.prepare('UPDATE seminars SET dates=? WHERE id=1').run(JSON.stringify(dates));
    assert.equal(store.list(1).rows[0].responses[dates[0]],undefined);
    db.prepare('DELETE FROM seminars WHERE id=1').run();assert.equal(db.prepare('SELECT count(*) n FROM event_staff_directory_links').get().n,0);
  }finally{db.close();}
});
