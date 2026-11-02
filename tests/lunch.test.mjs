import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createLunchStore } from '../lib/lunch.ts';
import { emptyLunch, parseLunch, lunchCost, summarizeLunch,defaultLunch,withLunchQuantities } from '../types/lunch.ts';
import {countLunchAttendance} from '../types/lunch-defaults.ts';

const dates = ['2027-06-01', '2027-06-08'];
const fields = { ...emptyLunch(), date: dates[0], target: 'LECTURER', quantity: 3, unit_price: 1200, additional_cost: 500, shop_name: '架空のお店', status: 'PLANNED' };
const input = (extra = {}) => ({ ...fields, schedule: dates, ...extra });
test('multi-target orders derive one total and retain separate counts, zero and unknown values',()=>{
  const counts={LECTURER:2,SUPPORT:1,PARTICIPANT:12,EXTERNAL_LECTURER:1,OTHER:0};
  const plan=parseLunch({...defaultLunch(counts,dates[0]),unit_price:900,additional_cost:500});
  assert.equal(plan.quantity,16);assert.equal(lunchCost(plan),14900);
  assert.deepEqual(plan.quantities,{EXTERNAL_LECTURER:1,LECTURER:2,SUPPORT:1,PARTICIPANT:12});
  assert.equal(parseLunch(withLunchQuantities(plan,plan.targets,{...counts,PARTICIPANT:null})).quantity,null);
  assert.equal(parseLunch(withLunchQuantities(plan,['SUPPORT'],{SUPPORT:0})).quantity,0);
  for(const bad of [{targets:[]},{targets:['LECTURER','LECTURER']},{quantities:{LECTURER:2}},{quantity:15},{quantities:{...plan.quantities,OTHER:0}},{quantities:{...plan.quantities,PARTICIPANT:-1}},{quantities:{...plan.quantities,PARTICIPANT:Number.MAX_SAFE_INTEGER}}])assert.throws(()=>parseLunch({...plan,...bad}),{status:400});
  const missing={...plan};delete missing.quantities;assert.throws(()=>parseLunch(missing),{status:400});
  const {db,store}=fixture();try{
    const saved=store.create(42,{...plan,schedule:dates},1);
    assert.deepEqual(saved.quantities,plan.quantities);assert.deepEqual(store.history(42)[0].after.targets,plan.targets);
    const edit=withLunchQuantities(plan,plan.targets,{...plan.quantities,PARTICIPANT:13});
    const updated=store.update(42,saved.id,{...edit,schedule:dates,version:saved.version},1);
    assert.equal(updated.quantity,17);assert.equal(store.list(42).plans.length,1);
  }finally{db.close();}
});
test('lunch defaults count only attending people on the selected date and separate participants',()=>{
  const people=[['SOCIETY_LECTURER','ATTENDING','ABSENT'],['LECTURER','ATTENDING','UNANSWERED'],['SOCIETY_SUPPORT','ATTENDING','ATTENDING'],['SUPPORT','ABSENT','ATTENDING'],['SOCIETY_SUPPORT','TENTATIVE','UNANSWERED'],['EXTERNAL_LECTURER','ATTENDING','ABSENT']].map(([role,a,b])=>({role,responses:{[dates[0]]:a,[dates[1]]:b}}));
  assert.deepEqual(countLunchAttendance(people,dates[0],12),{LECTURER:2,SUPPORT:1,EXTERNAL_LECTURER:1,PARTICIPANT:12,OTHER:0});
  assert.deepEqual(countLunchAttendance(people,dates[1],12),{LECTURER:0,SUPPORT:2,EXTERNAL_LECTURER:0,PARTICIPANT:12,OTHER:0});
  assert.equal(defaultLunch(countLunchAttendance([],null,0),null).quantity,0);
});
function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY,name TEXT,dates TEXT);
    CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER);
    INSERT INTO auth_users VALUES(1,1),(2,1),(3,0);`);
  db.prepare('INSERT INTO seminars VALUES(?,?,?)').run(42, '架空イベント', JSON.stringify(dates));
  db.prepare('INSERT INTO seminars VALUES(?,?,?)').run(43, '別イベント', '[]');
  return { db, store: createLunchStore(db) };
}

test('lunch costs distinguish unknown and zero, include extras and sum only active plans exactly', () => {
  assert.equal(lunchCost(fields), 4100);
  assert.equal(lunchCost({ ...fields, quantity: null }), null);
  assert.equal(lunchCost({ ...fields, unit_price: null }), null);
  assert.equal(lunchCost({ ...fields, additional_cost: null }), null);
  assert.equal(lunchCost({ ...fields, quantity: 0 }), 500);
  assert.equal(lunchCost({ ...fields, unit_price: 0, additional_cost: 0 }), 0);
  const summary = summarizeLunch([fields, { ...fields, quantity: null }, { ...fields, status: 'CANCELLED' }]);
  assert.deepEqual(summary, { quantity: '3', quantity_unknown: 1, cost: '4100', cost_unknown: 1 });
  const huge = { ...fields, quantity: Number.MAX_SAFE_INTEGER, unit_price: 1, additional_cost: 0 };
  assert.equal(summarizeLunch([huge, huge]).cost, '18014398509481982');
});

test('every target can have multiple date-specific orders with separate shops, and edits preserve other plans', () => {
  const { db, store } = fixture();
  try {
    for (const target of ['LECTURER', 'EXTERNAL_LECTURER', 'SUPPORT', 'PARTICIPANT', 'OTHER']) {
      const first = store.create(42, input({ target }), 1);
      const other = store.create(42, input({ target, date: dates[1], shop_name: '別のお店' }), 1);
      const updated = store.update(42, first.id, { ...input({ target, quantity: 4, status: 'ORDERED' }), version: 1 }, 2);
      assert.equal(lunchCost(updated), 5300);
      assert.equal(store.get(42, first.id).target, target);
      assert.equal(store.history(42)[0].after.target, target);
      assert.equal(store.get(42, other.id).shop_name, '別のお店');
      assert.equal(store.get(42, other.id).date, dates[1]);
    }
    createLunchStore(db);
    assert.equal(store.list(42).plans.length, 10);
    assert.equal(store.list(43).plans.length, 0);
    assert.equal(db.prepare('SELECT dates FROM seminars WHERE id=42').get().dates, JSON.stringify(dates));
    assert.ok(!JSON.stringify(store.history(42)).includes('お店'));
    assert.equal(store.history(42)[0].actor_id, 2);
  } finally { db.close(); }
});

test('bad dates, prices, counts, statuses, input types, overflow and impersonation are rejected', () => {
  for (const bad of [null, [], {}, { ...fields, target: 'toString' }, { ...fields, status: 'toString' },
    { ...fields, quantity: -1 }, { ...fields, quantity: 1.5 }, { ...fields, quantity: '3' },
    { ...fields, unit_price: -1 }, { ...fields, additional_cost: Infinity }, { ...fields, date: '2027-02-30' },
    { ...fields, shop_name: null }, { ...fields, notes: 'a'.repeat(2001) }, { ...fields, actor_id: 2 },
    { ...fields, quantity: Number.MAX_SAFE_INTEGER, unit_price: 2 }]) assert.throws(() => parseLunch(bad), { status: 400 });
  const { db, store } = fixture();
  try {
    assert.throws(() => store.create(42, input({ date: '2027-09-01' }), 1), { status: 400 });
    assert.throws(() => store.create(42, input({ schedule: null }), 1), { status: 400 });
    assert.throws(() => store.create(42, input(), 3), { status: 403 });
    assert.throws(() => store.create(99, input(), 1), { status: 404 });
    assert.equal(store.list(42).plans.length, 0);
    assert.equal(store.history(42).length, 0);
  } finally { db.close(); }
});

test('scope, versions and stale schedule snapshots prevent overwrites; old dates remain explicit until changed', () => {
  const { db, store } = fixture();
  try {
    let plan = store.create(42, input(), 1);
    plan = store.update(42, plan.id, { ...input({ quantity: 5 }), version: 1 }, 2);
    assert.throws(() => store.update(42, plan.id, { ...input(), version: 1 }, 1), { status: 409 });
    assert.throws(() => store.remove(42, plan.id, { version: 1 }, 1), { status: 409 });
    assert.throws(() => store.get(43, plan.id), { status: 404 });
    assert.throws(() => store.update(43, plan.id, { ...input(), version: 2 }, 1), { status: 404 });
    assert.throws(() => store.remove(43, plan.id, { version: 2 }, 1), { status: 404 });
    const newDates = ['2027-07-01'];
    db.prepare('UPDATE seminars SET dates=? WHERE id=42').run(JSON.stringify(newDates));
    assert.throws(() => store.update(42, plan.id, { ...input(), version: 2 }, 1), { status: 409 });
    assert.throws(() => store.create(42, input(), 1), { status: 409 });
    assert.equal(store.get(42, plan.id).date, dates[0]);
    plan = store.update(42, plan.id, { ...input({ schedule: newDates, status: 'CANCELLED' }), version: 2 }, 1);
    assert.equal(plan.date, dates[0]);
    plan = store.update(42, plan.id, { ...input({ schedule: newDates, date: newDates[0] }), version: plan.version }, 1);
    assert.equal(plan.date, newDates[0]);
    const pending = store.create(43, input({ schedule: [], date: null, quantity: null }), 1);
    assert.equal(pending.date, null);
    assert.equal(pending.quantity, null);
  } finally { db.close(); }
});

test('audit failures roll back writes and deletion, history contains no free text, and event deletion cascades', () => {
  const { db, store } = fixture();
  try {
    const plan = store.create(42, input({ target_details: 'Private name marker', shop_contact: 'Private contact marker' }), 1);
    db.exec("CREATE TRIGGER reject_lunch_audit BEFORE INSERT ON event_lunch_history BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
    assert.throws(() => store.create(42, input(), 1), /audit unavailable/);
    assert.throws(() => store.update(42, plan.id, { ...input({ quantity: 9 }), version: 1 }, 1), /audit unavailable/);
    assert.throws(() => store.remove(42, plan.id, { version: 1 }, 1), /audit unavailable/);
    assert.deepEqual(store.list(42).plans, [plan]);
    assert.ok(!JSON.stringify(store.history(42)).includes('Private'));
    db.exec('DROP TRIGGER reject_lunch_audit');
    store.remove(42, plan.id, { version: 1 }, 1);
    assert.equal(store.history(42)[0].action, 'deleted');
    store.create(42, input(), 1);
    db.prepare('DELETE FROM seminars WHERE id=42').run();
    assert.equal(db.prepare('SELECT count(*) n FROM event_lunch_plans').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM event_lunch_history').get().n, 0);
  } finally { db.close(); }
});
