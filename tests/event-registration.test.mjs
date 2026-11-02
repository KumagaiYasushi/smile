import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {createEventRegistrationStore} from '../lib/event-registration.ts';
import {createStaffRosterStore} from '../lib/staff-roster.ts';
import {createLunchStore} from '../lib/lunch.ts';
import {emptyLunch} from '../types/lunch.ts';
const dates=['2027-06-01','2027-06-08'];
function fixture() {
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY,name TEXT,dates TEXT,lecturer_name TEXT,assistant_members TEXT);
    CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER);INSERT INTO auth_users VALUES(1,1),(2,0);`);
  const store=createEventRegistrationStore(db),staff=createStaffRosterStore(db),lunch=createLunchStore(db);
  const create=()=>{const result=db.prepare('INSERT INTO seminars(name,dates,lecturer_name,assistant_members) VALUES(?,?,?,?)').run('架空イベント',JSON.stringify(dates),'','[]');return {id:Number(result.lastInsertRowid)};};
  const row=create(),member=staff.list(row.id).rows[0];
  const registration={schedule:dates,attendance:[{member_id:member.member_id,member_version:member.member_version,version:0,responses:{[dates[0]]:'ATTENDING',[dates[1]]:'ABSENT'}}],lunch:[{action:'create',data:{...emptyLunch(),date:dates[0],target:'EXTERNAL_LECTURER',quantity:2,unit_price:800,shop_name:'架空弁当店'}}]};
  return {db,store,staff,lunch,create,registration,row};
}
test('event creation stores both-date attendance and lunch together; unrelated edits preserve them',()=>{
  const {db,store,staff,lunch,create,registration}=fixture();try{
    const event=store.save(create,registration,1);
    const person=staff.list(event.id).rows.find(p=>p.person_id!==null);
    assert.equal(person.responses[dates[0]],'ATTENDING');assert.equal(person.responses[dates[1]],'ABSENT');
    assert.equal(lunch.list(event.id).plans[0].quantity,2);
    store.save(()=>{db.prepare('UPDATE seminars SET name=? WHERE id=?').run('改名',event.id);return event;},undefined,1);
    assert.equal(lunch.list(event.id).plans.length,1);assert.equal(staff.list(event.id).rows.find(p=>p.person_id!==null).version,person.version);
  }finally{db.close();}
});
test('invalid lunch rolls back new event and preceding attendance, including audit and links',()=>{
  const {db,store,create,registration}=fixture();try{
    assert.throws(()=>store.save(create,{...registration,lunch:[{action:'create',data:{...emptyLunch(),quantity:-1}}]},1),/人数/);
    assert.equal(db.prepare('SELECT count(*) n FROM seminars').get().n,1);
    for(const table of ['event_staff','event_staff_directory_links','event_staff_history','event_lunch_plans','event_lunch_history'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0);
  }finally{db.close();}
});
test('stale attendance or lunch rejects the whole edit without changing event details or other responses',()=>{
  const {db,store,staff,lunch,registration,row}=fixture();try{
    store.save(()=>row,registration,1);
    const plan=lunch.list(row.id).plans[0],member=staff.list(row.id).rows.find(p=>p.person_id!==null);
    lunch.update(row.id,plan.id,{...emptyLunch(),date:dates[0],quantity:4,schedule:dates,version:plan.version},1);
    const patch={schedule:dates,attendance:[{member_id:member.member_id,member_version:member.member_version,version:member.version,responses:{[dates[0]]:'ABSENT'}}],lunch:[{action:'update',id:plan.id,version:plan.version,data:{...emptyLunch(),quantity:9}}]};
    const edit=()=>{db.prepare('UPDATE seminars SET name=? WHERE id=?').run('未保存の改名',row.id);return row;};
    assert.throws(()=>store.save(edit,patch,1),{status:409});
    assert.equal(db.prepare('SELECT name FROM seminars WHERE id=?').get(row.id).name,'架空イベント');
    assert.equal(staff.list(row.id).rows.find(p=>p.person_id!==null).responses[dates[0]],'ATTENDING');
    assert.equal(lunch.list(row.id).plans[0].quantity,4);
    assert.throws(()=>store.save(edit,registration,1),{status:409});
  }finally{db.close();}
});
test('registration supports optional lunch, scoped deletion and unknown/free amounts and rejects forged metadata',()=>{
  const {db,store,lunch,create,registration,row}=fixture();try{
    store.save(()=>row,{...registration,attendance:[]},1);
    const plan=lunch.list(row.id).plans[0],other=create();
    assert.throws(()=>store.save(()=>other,{schedule:dates,attendance:[],lunch:[{action:'delete',id:plan.id,version:plan.version}]},1),{status:404});
    store.save(()=>row,{schedule:dates,attendance:[],lunch:[{action:'update',id:plan.id,version:plan.version,data:{...emptyLunch(),unit_price:0,quantity:null}},{action:'create',data:emptyLunch()}]},1);
    const plans=lunch.list(row.id).plans;assert.equal(plans[0].unit_price,0);assert.equal(plans[0].quantity,null);
    store.save(()=>row,{schedule:dates,attendance:[],lunch:[{action:'delete',id:plan.id,version:plans[0].version}]},1);assert.equal(lunch.list(row.id).plans.length,1);
    assert.throws(()=>store.save(create,{...registration,actor_id:999},1),{status:400});
    assert.throws(()=>store.save(create,{...registration,schedule:[]},1),{status:409});
    assert.throws(()=>store.save(create,undefined,2),{status:403});
  }finally{db.close();}
});
