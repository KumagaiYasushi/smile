import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {createStandardTaskStore,STANDARD_TASKS} from '../lib/standard-tasks.ts';
import {createTaskStore} from '../lib/tasks.ts';
import {eventSessionName} from '../types/event-session.ts';
import {buildHomeRows} from '../types/home.ts';
function fixture(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY,external_lecturer TEXT);CREATE TABLE auth_users(id INTEGER PRIMARY KEY,email TEXT,active INTEGER);INSERT INTO auth_users VALUES(1,'member@example.invalid',1),(2,'inactive@example.invalid',0);`);for(const [id,status]of [[1,'YES'],[2,'NO']])db.prepare('INSERT INTO seminars VALUES(?,?)').run(id,JSON.stringify({status}));return {db,store:createStandardTaskStore(db),tasks:createTaskStore(db)};}
test('guest events receive six independent tasks; other events receive one, with no invented due dates or assignments',()=>{
  const {db,store,tasks}=fixture();try{
    assert.equal(store.initialize(1,1).created,6);assert.equal(store.initialize(2,1).created,1);
    assert.deepEqual(tasks.listTasks(1).map(p=>p.title),STANDARD_TASKS.map(p=>p.title));
    assert.ok(tasks.listTasks(1).every(p=>p.status==='NOT_STARTED'&&p.due_date===null&&p.assignee_id===null&&p.collaborator_ids.length===0));
    assert.equal(store.initialize(1,1).created,0);assert.equal(tasks.listTasks(1).length,6);
    db.prepare('UPDATE seminars SET external_lecturer=? WHERE id=2').run('{"status":"YES"}');assert.equal(store.initialize(2,1).created,5);
  }finally{db.close();}
});
test('saved edits, deleted tasks and existing matching manual tasks survive initialization without duplication or resurrection',()=>{
  const {db,store,tasks}=fixture();try{
    const manual=tasks.createTask(1,{title:STANDARD_TASKS[0].title,status:'DONE',due_date:'2027-01-01',assignee_id:1},1);
    assert.equal(store.initialize(1,1).created,5);assert.equal(tasks.getTask(1,manual.id).version,manual.version);
    const all=tasks.listTasks(1),second=all.find(p=>p.id!==manual.id);
    tasks.updateTask(1,manual.id,{title:'利用者が変更した依頼状名'},manual.version,1);tasks.deleteTask(1,second.id,second.version,1);
    assert.equal(store.initialize(1,1).created,0);assert.equal(tasks.listTasks(1).length,5);assert.ok(tasks.listTasks(1).some(p=>p.title==='利用者が変更した依頼状名'));
    db.prepare('UPDATE seminars SET external_lecturer=? WHERE id=1').run('{"status":"NO"}');store.initialize(1,1);assert.equal(tasks.listTasks(1).length,5);
    db.prepare('DELETE FROM seminars WHERE id=1').run();assert.equal(db.prepare('SELECT count(*) n FROM event_standard_tasks WHERE seminar_id=1').get().n,0);
  }finally{db.close();}
});
test('standard task audit failures roll back every generated task and marker; actors and scope are checked',()=>{
  const {db,store,tasks}=fixture();try{
    assert.throws(()=>store.initialize(1,2),{status:403});assert.throws(()=>store.initialize(99,1),{status:404});
    db.exec("CREATE TRIGGER fail_standard BEFORE INSERT ON event_standard_tasks WHEN NEW.task_key='photo' BEGIN SELECT RAISE(ABORT,'marker failed');END");
    assert.throws(()=>store.initialize(1,1),/marker failed/);assert.equal(tasks.listTasks(1).length,0);assert.equal(db.prepare('SELECT count(*) n FROM task_history').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM event_standard_tasks').get().n,0);
  }finally{db.close();}
});
test('multiple sessions show event name plus chronological occurrence without changing stored event names',()=>{
  const event={id:1,name:'ベーシックコース',event_type:'BASIC_COURSE',occurrence_type:'MULTIPLE',dates:['2027-06-08','2027-06-01'],event_times:{}};
  assert.equal(eventSessionName(event,'2027-06-01'),'ベーシックコース 第1回');assert.equal(eventSessionName(event,'2027-06-08'),'ベーシックコース 第2回');assert.equal(event.name,'ベーシックコース');
  assert.deepEqual(buildHomeRows([event],[]).map(p=>p.event_name),['ベーシックコース 第1回','ベーシックコース 第2回']);assert.equal(eventSessionName({...event,occurrence_type:'SINGLE'},'2027-06-01'),event.name);
});
