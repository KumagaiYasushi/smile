import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {allowOtherEvents} from '../lib/event-type-migration.ts';
test('OTHER migration preserves children, triggers, indexes, custom columns, timestamps and autoincrement high water',()=>{
  const db=new Database(':memory:');try{
    db.pragma('foreign_keys=ON');db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT CHECK(event_type IN ('BASIC_COURSE','LECTURE','SEMINAR')),updated_at TEXT,extra TEXT);CREATE TABLE child(id INTEGER PRIMARY KEY,seminar_id INTEGER REFERENCES seminars(id) ON DELETE CASCADE);CREATE TABLE changes(id INTEGER);CREATE INDEX custom_event_index ON seminars(extra);CREATE TRIGGER track_update AFTER UPDATE ON seminars BEGIN INSERT INTO changes VALUES(NEW.id);END;INSERT INTO seminars VALUES(7,'SEMINAR','original','keep');INSERT INTO child VALUES(1,7);INSERT INTO seminars(id,event_type) VALUES(100,'SEMINAR');DELETE FROM seminars WHERE id=100;`);
    allowOtherEvents(db);allowOtherEvents(db);
    assert.equal(db.pragma('foreign_keys',{simple:true}),1);assert.deepEqual(db.prepare('SELECT * FROM child').all(),[{id:1,seminar_id:7}]);assert.equal(db.prepare('SELECT extra FROM seminars WHERE id=7').get().extra,'keep');assert.equal(db.prepare('SELECT updated_at FROM seminars WHERE id=7').get().updated_at,'original');assert.equal(db.prepare('SELECT count(*) n FROM changes').get().n,0);
    assert.equal(Number(db.prepare("INSERT INTO seminars(event_type) VALUES('OTHER')").run().lastInsertRowid),101);
    db.prepare('UPDATE seminars SET extra=? WHERE id=7').run('edited');assert.equal(db.prepare('SELECT count(*) n FROM changes').get().n,1);assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='custom_event_index'").get());assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();}
});
test('failed OTHER migration restores the original schema/data and foreign-key setting',()=>{
  const db=new Database(':memory:');try{
    db.pragma('foreign_keys=ON');db.exec("CREATE TABLE seminars(id INTEGER PRIMARY KEY AUTOINCREMENT,event_type TEXT CHECK(event_type IN ('BASIC_COURSE','LECTURE','SEMINAR')))");
    db.pragma('ignore_check_constraints=ON');db.exec("INSERT INTO seminars(event_type) VALUES('legacy-invalid')");db.pragma('ignore_check_constraints=OFF');
    assert.throws(()=>allowOtherEvents(db),/CHECK constraint/);assert.equal(db.pragma('foreign_keys',{simple:true}),1);assert.equal(db.prepare('SELECT event_type FROM seminars').get().event_type,'legacy-invalid');assert.ok(!db.prepare("SELECT name FROM sqlite_master WHERE name='seminars_other_migration'").get());
  }finally{db.close();}
});
