import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {createExternalLecturerStore,resolveExternalSelection,INITIAL_EXTERNAL_LECTURERS} from '../lib/external-lecturers.ts';
function fixture(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec('CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER);INSERT INTO auth_users VALUES(1,1),(2,0)');return {db,store:createExternalLecturerStore(db)};}
test('requested names and facilities seed once; edits/archive persist and existing event snapshots remain stable',()=>{
  const {db,store}=fixture();try{
    assert.deepEqual(store.list().map(({name,facility})=>({name,facility})).sort((a,b)=>a.name.localeCompare(b.name)),[...INITIAL_EXTERNAL_LECTURERS].sort((a,b)=>a.name.localeCompare(b.name)));
    const person=store.list()[0],snapshot=resolveExternalSelection(db,{status:'YES',id:person.id,name:'forged',facility:'forged'});
    assert.equal(snapshot.name,person.name);assert.equal(snapshot.facility,person.facility);
    store.save({name:'架空の改名',facility:'架空の変更施設',active:false,version:person.version},1,person.id);
    createExternalLecturerStore(db);assert.equal(store.list().length,2);assert.equal(store.list().find(p=>p.id===person.id).active,false);
    assert.deepEqual(resolveExternalSelection(db,{status:'YES',id:person.id},snapshot),snapshot);
    assert.throws(()=>resolveExternalSelection(db,{status:'YES',id:person.id}),{status:400});
    const hidden=resolveExternalSelection(db,{status:'NO'},snapshot);assert.equal(hidden.name,person.name);assert.equal(hidden.status,'NO');
    assert.deepEqual(resolveExternalSelection(db,{status:'YES',id:person.id},hidden),snapshot);
    assert.deepEqual(resolveExternalSelection(db,{status:'YES',id:null},{status:'YES',id:null,name:'旧記録の外来講師',facility:''}),{status:'YES',id:null,name:'旧記録の外来講師',facility:''});
  }finally{db.close();}
});
test('external directory rejects bad input, duplicate, stale versions and inactive actors; failed audit rolls back',()=>{
  const {db,store}=fixture();try{
    const body={name:'架空外来講師',facility:'架空施設',active:true},p=store.save(body,1);
    assert.throws(()=>store.save(body,1),{status:409});
    assert.throws(()=>store.save({...body,name:'別人'},2),{status:403});
    assert.throws(()=>store.save({...body,version:99},1,p.id),{status:409});
    for(const bad of [{name:''},{facility:''},{active:1},{actor_id:2}])assert.throws(()=>store.save({...body,...bad},1),{status:400});
    for(const bad of [null,[],{status:'bad'},{status:'YES',id:0},{status:'YES',id:999},{status:'YES',id:String(p.id)},{status:'NO',actor_id:2}])assert.throws(()=>resolveExternalSelection(db,bad),{status:400});
    db.exec("CREATE TRIGGER fail_external_audit BEFORE INSERT ON external_lecturer_history BEGIN SELECT RAISE(ABORT,'audit failed'); END");
    assert.throws(()=>store.save({...body,name:'変更',version:p.version},1,p.id),/audit failed/);
    assert.throws(()=>store.save({...body,name:'新規'},1),/audit failed/);
    assert.equal(store.list().length,3);assert.equal(store.list().find(row=>row.id===p.id).name,p.name);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM external_lecturer_history').all()).includes('架空'));
  }finally{db.close();}
});
