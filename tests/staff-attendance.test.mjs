import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createStaffAttendanceStore } from '../lib/staff-attendance.ts';
import {getLunchDefaults} from '../lib/lunch-defaults.ts';

const dates = ['2027-06-01', '2027-06-08'];
const responses = { '2027-06-01': 'ATTENDING', '2027-06-08': 'ABSENT' };
const input = (extra = {}) => ({ name: '架空講師', role: 'SOCIETY_LECTURER', schedule: dates, responses, ...extra });
function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY,name TEXT,dates TEXT,lecturer_name TEXT,assistant_members TEXT);
    CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER);
    INSERT INTO auth_users VALUES(1,1),(2,1),(3,0);
    CREATE TABLE participants(id INTEGER PRIMARY KEY,seminar_id INTEGER,attended INTEGER);
    INSERT INTO participants VALUES(7,42,0);`);
  db.prepare('INSERT INTO seminars VALUES(?,?,?,?,?)').run(42, '架空イベント', JSON.stringify(dates), '架空講師', JSON.stringify(['支援一', '支援二', '支援一', ' ']));
  db.prepare('INSERT INTO seminars VALUES(?,?,?,?,?)').run(43, '別イベント', '[]', '', '[]');
  return { db, store: createStaffAttendanceStore(db) };
}
test('selected external lecturer can be imported without duplicating the research lead; lunch defaults follow dated attendance and participant registry',()=>{
  const {db,store}=fixture();try{
    db.exec('ALTER TABLE seminars ADD COLUMN external_lecturer TEXT;ALTER TABLE seminars ADD COLUMN lecturer_role TEXT');
    db.prepare('UPDATE seminars SET lecturer_role=?,external_lecturer=? WHERE id=42').run('SOCIETY_LECTURER',JSON.stringify({status:'YES',id:1,name:'架空の外来講師',facility:'架空病院'}));
    assert.equal(getLunchDefaults(db,42)[dates[0]].EXTERNAL_LECTURER,1);
    assert.equal(store.importNames(42,{schedule:dates},1).added,4);
    assert.equal(store.importNames(42,{schedule:dates},1).added,0);
    const external=store.list(42).people.find(p=>p.role==='EXTERNAL_LECTURER');
    store.update(42,external.id,{name:external.name,role:external.role,schedule:dates,responses,version:external.version},1);
    const values=getLunchDefaults(db,42);
    assert.equal(values[dates[0]].EXTERNAL_LECTURER,1);assert.equal(values[dates[1]].EXTERNAL_LECTURER,0);
    assert.equal(values[dates[0]].PARTICIPANT,1);assert.equal(values[dates[0]].LECTURER,0);
    db.prepare('UPDATE seminars SET external_lecturer=? WHERE id=42').run(JSON.stringify({status:'NO',id:1,name:external.name,facility:'架空病院'}));
    assert.equal(getLunchDefaults(db,42)[dates[0]].EXTERNAL_LECTURER,0);
  }finally{db.close();}
});

test('staff plans store separate dates and roles, can be revised, and never set actual participant attendance', () => {
  const { db, store } = fixture();
  try {
    let person = store.create(42, input({ name: ' 架空講師 ' }), 1);
    assert.equal(person.name, '架空講師');
    assert.deepEqual(person.responses, responses);
    for (const status of ['UNANSWERED', 'TENTATIVE', 'ATTENDING', 'AM_ONLY', 'PM_ONLY', 'ABSENT']) {
      person = store.update(42, person.id, { ...input({ responses: { ...responses, [dates[0]]: status }, role: 'SOCIETY_SUPPORT' }), version: person.version }, 2);
      assert.equal(person.responses[dates[0]], status);
      assert.equal(person.responses[dates[1]], 'ABSENT');
    }
    createStaffAttendanceStore(db);
    assert.equal(store.list(42).people.length, 1);
    assert.equal(store.list(43).people.length, 0);
    assert.equal(db.prepare('SELECT attended FROM participants WHERE id=7').get().attended, 0);
    assert.equal(db.prepare('SELECT lecturer_name FROM seminars WHERE id=42').get().lecturer_name, '架空講師');
    const history = store.history(42);
    assert.equal(history[0].actor_id, 2);
    assert.equal(history[0].before.responses[dates[0]], 'PM_ONLY');
    assert.equal(history[0].after.responses[dates[0]], 'ABSENT');
    assert.ok(!JSON.stringify(history).includes('架空講師'));
    store.remove(42, person.id, { version: person.version }, 1);
    assert.equal(store.list(42).people.length, 0);
    assert.equal(store.history(42)[0].action, 'deleted');
  } finally { db.close(); }
});

test('importing existing lecturer/support names is idempotent and preserves prior answers', () => {
  const { db, store } = fixture();
  try {
    const person = store.create(42, input(), 1);
    assert.equal(store.importNames(42, { schedule: dates }, 1).added, 2);
    assert.equal(store.importNames(42, { schedule: dates }, 1).added, 0);
    assert.deepEqual(store.get(42, person.id).responses, responses);
    assert.equal(store.get(42, person.id).version, 1);
    assert.deepEqual(store.list(42).people[1].responses, { [dates[0]]: 'UNANSWERED', [dates[1]]: 'UNANSWERED' });
    assert.throws(() => store.create(42, input(), 1), { status: 409 });
    assert.equal(store.create(42, input({ role: 'SOCIETY_SUPPORT' }), 1).role, 'SOCIETY_SUPPORT');
    db.prepare('UPDATE seminars SET lecturer_name=? WHERE id=42').run('変更された講師');
    assert.equal(store.list(42).people[0].name, '架空講師');
    assert.equal(store.importNames(42, { schedule: dates }, 1).added, 1);
  } finally { db.close(); }
});

test('invalid inputs, unknown dates, impersonation and inactive actors cannot change plans', () => {
  const { db, store } = fixture();
  try {
    for (const body of [null, [], {}, input({ name: ' ' }), input({ name: 'a'.repeat(201) }), input({ role: 'toString' }),
      input({ responses: {} }), input({ responses: { ...responses, [dates[0]]: 'toString' } }),
      input({ responses: { ...responses, extra: 'ATTENDING' } }), input({ responses: [] }),
      input({ schedule: null }), input({ actor_id: 2 }), input({ attended: true })]) {
      assert.throws(() => store.create(42, body, 1), { status: 400 });
    }
    assert.throws(() => store.create(42, input(), 3), { status: 403 });
    assert.throws(() => store.create(99, input(), 1), { status: 404 });
    assert.equal(store.list(42).people.length, 0);
    assert.equal(store.history(42).length, 0);
  } finally { db.close(); }
});

test('versions and event scope reject lost edits/deletion without creating history', () => {
  const { db, store } = fixture();
  try {
    const person = store.create(42, input(), 1);
    store.update(42, person.id, { ...input(), version: 1 }, 2);
    const historyLength = store.history(42).length;
    assert.throws(() => store.update(42, person.id, { ...input(), version: 1 }, 1), { status: 409 });
    assert.throws(() => store.remove(42, person.id, { version: 1 }, 1), { status: 409 });
    assert.throws(() => store.get(43, person.id), { status: 404 });
    assert.throws(() => store.update(43, person.id, { ...input(), version: 2 }, 1), { status: 404 });
    assert.throws(() => store.remove(43, person.id, { version: 2 }, 1), { status: 404 });
    assert.equal(store.history(42).length, historyLength);
  } finally { db.close(); }
});

test('changed/undetermined schedules keep old answers and require fresh confirmation for new dates', () => {
  const { db, store } = fixture();
  try {
    let person = store.create(42, input(), 1);
    const newDates = ['2027-07-01'];
    db.prepare('UPDATE seminars SET dates=? WHERE id=42').run(JSON.stringify(newDates));
    assert.throws(() => store.update(42, person.id, { ...input(), version: 1 }, 1), { status: 409 });
    assert.throws(() => store.create(42, input({ name: '新規' }), 1), { status: 409 });
    assert.throws(() => store.importNames(42, { schedule: dates }, 1), { status: 409 });
    assert.equal(store.get(42, person.id).responses[newDates[0]], undefined);
    person = store.update(42, person.id, { ...input({ schedule: newDates, responses: { [newDates[0]]: 'UNANSWERED' } }), version: 1 }, 1);
    assert.deepEqual(person.responses, { ...responses, [newDates[0]]: 'UNANSWERED' });
    let undated = store.create(43, input({ schedule: [], responses: { '': 'TENTATIVE' } }), 1);
    db.prepare('UPDATE seminars SET dates=? WHERE id=43').run(JSON.stringify(newDates));
    undated = store.update(43, undated.id, { ...input({ schedule: newDates, responses: { [newDates[0]]: 'ATTENDING' } }), version: 1 }, 1);
    assert.deepEqual(undated.responses, { '': 'TENTATIVE', [newDates[0]]: 'ATTENDING' });
    assert.throws(() => store.update(43, undated.id, { ...input({ schedule: newDates, responses: { ...responses } }), version: 2 }, 1), { status: 400 });
  } finally { db.close(); }
});

test('audit failures roll back creates, updates, deletes and entire imports; event deletion cascades', () => {
  const { db, store } = fixture();
  try {
    const person = store.create(42, input(), 1);
    db.exec("CREATE TRIGGER reject_staff_audit BEFORE INSERT ON event_staff_history WHEN NEW.person_id>1 OR NEW.action!='created' BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
    assert.throws(() => store.update(42, person.id, { ...input({ name: '変更' }), version: 1 }, 1), /audit unavailable/);
    assert.throws(() => store.remove(42, person.id, { version: 1 }, 1), /audit unavailable/);
    assert.throws(() => store.create(42, input({ name: '新規' }), 1), /audit unavailable/);
    db.exec('DROP TRIGGER reject_staff_audit');
    db.exec("CREATE TRIGGER reject_staff_audit BEFORE INSERT ON event_staff_history WHEN NEW.person_id>2 BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
    assert.throws(() => store.importNames(42, { schedule: dates }, 1), /audit unavailable/);
    assert.deepEqual(store.list(42).people, [person]);
    assert.equal(store.history(42).length, 1);
    db.exec('DROP TRIGGER reject_staff_audit');
    store.importNames(42, { schedule: dates }, 1);
    db.prepare('DELETE FROM seminars WHERE id=42').run();
    assert.equal(db.prepare('SELECT count(*) n FROM event_staff').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM event_staff_history').get().n, 0);
  } finally { db.close(); }
});

test('all three new roles are selectable; legacy role migration preserves IDs, answers, history and sequence', () => {
  const { db } = fixture();
  try {
    db.exec(`DROP TABLE event_staff;
      CREATE TABLE event_staff (
        id INTEGER PRIMARY KEY AUTOINCREMENT,seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
        role TEXT NOT NULL CHECK(role IN ('LECTURER','SUPPORT')),responses_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL DEFAULT 'old-time',UNIQUE(seminar_id,role,name));`);
    db.prepare('INSERT INTO event_staff(id,seminar_id,name,role,responses_json,version) VALUES(?,?,?,?,?,?)').run(42,42,'架空講師','LECTURER',JSON.stringify(responses),7);
    db.prepare('INSERT INTO event_staff(id,seminar_id,name,role) VALUES(?,?,?,?)').run(99,42,'削除済','SUPPORT');
    db.exec('DELETE FROM event_staff WHERE id=99');
    db.prepare("INSERT INTO event_staff_history(seminar_id,person_id,actor_id,action,after_json) VALUES(42,42,1,'created',?)").run(JSON.stringify({role:'LECTURER',responses}));
    const store=createStaffAttendanceStore(db);
    const old=store.get(42,42);
    assert.equal(old.role,'LECTURER'); assert.equal(old.version,7); assert.equal(old.updated_at,'old-time');
    assert.deepEqual(old.responses,responses);
    assert.equal(store.history(42)[0].person_id,42);
    assert.equal(store.history(42)[0].after.role,'LECTURER');
    assert.throws(()=>store.create(42,input({role:'LECTURER'}),1), {status:400});
    assert.throws(()=>store.create(42,input({role:'SUPPORT'}),1), {status:400});
    assert.equal(store.importNames(42,{schedule:dates},1).added,2);
    assert.equal(store.importNames(42,{schedule:dates},1).added,0);
    for(const role of ['EXTERNAL_LECTURER','SOCIETY_LECTURER','SOCIETY_SUPPORT']) {
      const person=store.create(42,input({role,name:`追加${role}`}),1);
      assert.ok(person.id>99); assert.equal(person.role,role);
    }
    const revised=store.update(42,42,{...input({role:'EXTERNAL_LECTURER'}),version:7},1);
    assert.equal(revised.role,'EXTERNAL_LECTURER'); assert.deepEqual(revised.responses,responses);
    createStaffAttendanceStore(db);
    assert.deepEqual(store.get(42,42),revised);
    assert.deepEqual(db.pragma('foreign_key_check'),[]);
  } finally { db.close(); }
});
