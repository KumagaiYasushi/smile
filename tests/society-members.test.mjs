import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {createSocietyMemberStore,INITIAL_SOCIETY_MEMBERS} from '../lib/society-members.ts';
function fixture(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec('CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER); INSERT INTO auth_users VALUES(1,1),(2,0)');return {db,store:createSocietyMemberStore(db)};}
test('the six lecturers and four support names are seeded once; renaming and archiving survive initialization',()=>{
  const {db,store}=fixture();try {
    assert.equal(store.list().length,10);
    for(const [role,names]of Object.entries(INITIAL_SOCIETY_MEMBERS))assert.deepEqual(store.list().filter(p=>p.role===role).map(p=>p.name).sort(),[...names].sort());
    const p=store.list()[0],saved=store.save({name:'架空の改名',role:p.role,active:false,version:p.version},1,p.id);
    // Use only editable fields when saving via the API.
    assert.equal(saved.active,false);
    createSocietyMemberStore(db);assert.equal(store.list().length,10);assert.equal(store.list().find(p=>p.id===saved.id).name,'架空の改名');
  }finally{db.close();}
});
test('directory validates input, actors, duplicates and revisions and rolls back failed audit',()=>{
  const {db,store}=fixture();try {
    const body={name:'架空講師',role:'SOCIETY_LECTURER',active:true};
    const p=store.save(body,1);
    assert.throws(()=>store.save(body,1),{status:409});
    assert.throws(()=>store.save({...body,name:'B'},2),{status:403});
    assert.throws(()=>store.save({...body,version:9},1,p.id),{status:409});
    for(const extra of [{role:'EXTERNAL_LECTURER'},{name:''},{active:1},{actor_id:2}])assert.throws(()=>store.save({...body,...extra},1),{status:400});
    db.exec("CREATE TRIGGER fail_history BEFORE INSERT ON society_member_history BEGIN SELECT RAISE(ABORT,'audit failed'); END");
    assert.throws(()=>store.save({...body,name:'B',version:p.version},1,p.id),/audit failed/);
    assert.equal(store.list().find(x=>x.id===p.id).name,p.name);
    assert.throws(()=>store.save({...body,name:'B'},1),/audit failed/);assert.equal(store.list().length,11);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM society_member_history').all()).includes('架空講師'));
  }finally{db.close();}
});
