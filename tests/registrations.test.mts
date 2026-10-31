import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { AuthStore } from '../lib/auth-store.ts';
import { EventError, EventStore } from '../lib/event-store.ts';
import { RegistrationStore } from '../lib/registration-store.ts';
import type { Contact } from '../types/registration.ts';

const contact: Contact = { name: '架空 申込者', mobile: '000-0000-0000', email: 'person@example.invalid', workplace: '架空歯科' };
function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON');
  new AuthStore(db, randomBytes(32)).createUser('a@example.invalid', '架空管理者', 'only-fictional-test-password');
  const events = new EventStore(db);
  events.saveTemplate({ family: 'LECTURE_SEMINAR', title: '架空準備', relative_days: -7, phase: 'PREPARATION', important: true, active: true }, 1);
  const input = { type: 'SEMINAR', title: '架空イベント', owner_id: 1, capacity: 1, sessions: [{ starts_at: '2028-01-10T10:00+09:00', ends_at: '2028-01-10T17:00+09:00' }] };
  const a = events.create(input, 1), b = events.create({ ...input, title: '架空イベントB' }, 1);
  return { db, store: new RegistrationStore(db), a: a.id, b: b.id };
}
function record(snapshot = contact, key = randomUUID()) { return { request_key: key, snapshot }; }
function rejectsStatus(action: () => unknown, status: number) {
  assert.throws(action, error => error instanceof EventError && error.status === status);
}
function count(db: Database.Database, table: string) { return (db.prepare(`SELECT count(*) as n FROM ${table}`).get() as { n: number }).n; }

test('AT06: both exact name and mobile with a unique candidate link across events', () => {
  const { db, store, a, b } = fixture();
  const first = store.register(a, record(), 1), next = store.register(b, record(), 1);
  assert.equal(first.match_status, 'NEW'); assert.equal(next.match_status, 'EXACT');
  assert.equal(first.participant_id, next.participant_id); assert.equal(count(db, 'participant_masters'), 1);
  assert.equal(store.detail(first.participant_id).registrations.length, 2);
  assert.equal(first.application_status, 'PENDING_REVIEW'); assert.equal(first.attendance_status, 'UNVERIFIED');
  assert.equal(count(db, 'registrations'), 2);
  db.close();
});

test('name only, mobile only, email only and missing keys never merge participants', () => {
  const { db, store, a } = fixture();
  const first = store.register(a, record(), 1);
  for (const snapshot of [
    { ...contact, mobile: '000-1111-1111' }, { ...contact, name: '別の架空人' },
    { ...contact, name: '', mobile: '' }, { ...contact, name: '' }, { ...contact, mobile: '' },
  ]) {
    const result = store.register(a, record(snapshot), 1);
    assert.notEqual(result.participant_id, first.participant_id); assert.notEqual(result.match_status, 'EXACT');
  }
  assert.equal(count(db, 'participant_masters'), 6); db.close();
});

test('spelling, phone punctuation, whitespace, width and case are not normalized for linking', () => {
  const { db, store, a } = fixture(); const first = store.register(a, record(), 1);
  for (const snapshot of [
    { ...contact, mobile: '00000000000' }, { ...contact, name: ` ${contact.name}` },
    { ...contact, name: contact.name.replace(' ', '　') }, { ...contact, mobile: '０００-００００-００００' },
  ]) assert.notEqual(store.register(a, record(snapshot), 1).participant_id, first.participant_id);
  const upper = store.register(a, record({ ...contact, name: 'Test Name' }), 1);
  assert.notEqual(store.register(a, record({ ...contact, name: 'test name' }), 1).participant_id, upper.participant_id);
  db.close();
});

test('multiple candidates are preserved for review and never silently merged', () => {
  const { db, store, a } = fixture();
  const first = store.register(a, record(), 1), other = store.register(a, record({ ...contact, name: '別名' }), 1);
  store.update(other.participant_id, { version: 1, contact }, 1);
  const ambiguous = store.register(a, record(), 1);
  assert.equal(ambiguous.match_status, 'AMBIGUOUS');
  assert.deepEqual(ambiguous.candidate_ids, [first.participant_id, other.participant_id]);
  assert(!ambiguous.candidate_ids.includes(ambiguous.participant_id));
  assert.equal(count(db, 'participant_masters'), 3); db.close();
});

test('new application preserves a changed snapshot without selecting a new representative contact', () => {
  const { db, store, a, b } = fixture();
  const first = store.register(a, record(), 1);
  const changed = { ...contact, email: 'new@example.invalid', workplace: '新しい架空勤務先' };
  const next = store.register(b, record(changed), 1);
  assert.equal(next.participant_id, first.participant_id);
  assert.deepEqual(store.getRegistration(first.id).snapshot, contact);
  assert.deepEqual(store.getRegistration(next.id).snapshot, changed);
  assert.equal(store.detail(first.participant_id).current_email, contact.email);
  assert.equal(store.detail(first.participant_id).revisions.length, 1); db.close();
});

test('manual representative updates preserve old snapshots and before/after contact history', () => {
  const { db, store, a, b } = fixture();
  const first = store.register(a, record(), 1);
  const changed = { ...contact, name: '更新後の架空氏名', mobile: '000-2222-2222', workplace: '変更後の架空歯科' };
  const detail = store.update(first.participant_id, { version: 1, contact: changed }, 1);
  assert.equal(detail.version, 2); assert.equal(detail.revisions.length, 2);
  assert.deepEqual(detail.revisions[0].before, contact); assert.deepEqual(detail.revisions[0].after, changed);
  assert.deepEqual(store.getRegistration(first.id).snapshot, contact);
  assert.equal(store.update(first.participant_id, { version: 2, contact: changed }, 1).revisions.length, 2, 'no-op edit adds no fake history');
  rejectsStatus(() => store.update(first.participant_id, { version: 1, contact }, 1), 409);
  const oldKey = store.register(b, record(), 1);
  assert.notEqual(oldKey.participant_id, first.participant_id, 'historical phone/name are not unapproved aliases');
  assert.throws(() => db.prepare('UPDATE registration_snapshots SET snapshot_json=? WHERE registration_id=?').run('{}', first.id));
  db.close();
});

test('same request retries create no duplicate master, application, history or audit; changed retries conflict', () => {
  const { db, store, a, b } = fixture(); const key = randomUUID();
  const first = store.register(a, record(contact, key), 1);
  assert.deepEqual(store.register(a, record(contact, key.toUpperCase()), 1), first);
  for (const table of ['participant_masters', 'registrations', 'registration_snapshots', 'participant_contact_histories', 'participant_audit_logs']) assert.equal(count(db, table), 1);
  rejectsStatus(() => store.register(a, record({ ...contact, workplace: '別の架空勤務先' }, key), 1), 409);
  rejectsStatus(() => store.register(b, record(contact, key), 1), 409);
  assert.equal(count(db, 'registrations'), 1); db.close();
});

test('capacity does not imply confirmed seats; audit stores no contact values', () => {
  const { db, store, a } = fixture();
  store.register(a, record(), 1); store.register(a, record({ ...contact, name: '別の架空申込' }), 1);
  assert(store.forEvent(a).every(row => row.application_status === 'PENDING_REVIEW' && row.attendance_status === 'UNVERIFIED'));
  const first = store.forEvent(a)[0]; store.update(first.participant_id, { version: 1, contact: { ...first.snapshot, email: 'updated@example.invalid' } }, 1);
  const audit = JSON.stringify(db.prepare('SELECT * FROM participant_audit_logs').all());
  for (const value of Object.values(contact)) assert(!audit.includes(value));
  assert(!audit.includes('updated@example.invalid')); db.close();
});

test('search handles literal wildcards, special characters and page boundaries', () => {
  const { db, store, a } = fixture();
  store.register(a, record({ ...contact, name: '架空%_\\記号' }), 1);
  for (let i = 0; i < 30; i++) store.register(a, record({ ...contact, name: `架空参加者${i}` }), 1);
  assert.equal(store.search().total, 31); assert.equal(store.search().items.length, 30); assert.equal(store.search('', 2).items.length, 1);
  for (const query of ['%', '_', '\\']) assert.equal(store.search(query).total, 1);
  assert.equal(store.search("' OR 1=1 --").total, 0); assert.equal(store.search('参加者2').total, 11);
  rejectsStatus(() => store.search('', 0), 400); db.close();
});

test('invalid input, injected attendance, bad IDs and inactive actors are rejected without changes', () => {
  const { db, store, a } = fixture();
  rejectsStatus(() => store.register(a, { ...record(), attended: true }, 1), 400);
  rejectsStatus(() => store.register(a, record({ name: '', mobile: '', email: '', workplace: '' }), 1), 400);
  rejectsStatus(() => store.register(a, record({ ...contact, email: 'invalid' }), 1), 400);
  rejectsStatus(() => store.register(a, record({ ...contact, name: 'bad\nname' }), 1), 400);
  rejectsStatus(() => store.register(999, record(), 1), 404);
  rejectsStatus(() => store.detail(999), 404); rejectsStatus(() => store.forEvent(999), 404);
  db.prepare('UPDATE users SET active=0').run();
  rejectsStatus(() => store.register(a, record(), 1), 403);
  assert.equal(count(db, 'participant_masters'), 0); db.close();
});

test('audit failure rolls back both registration creation and representative changes', () => {
  const { db, store, a } = fixture(); const first = store.register(a, record(), 1);
  const before = store.detail(first.participant_id);
  db.exec("CREATE TRIGGER reject_participant_audit BEFORE INSERT ON participant_audit_logs BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
  assert.throws(() => store.register(a, record({ ...contact, name: '別の架空人' }), 1));
  for (const table of ['participant_masters', 'registrations', 'registration_snapshots', 'participant_contact_histories']) assert.equal(count(db, table), 1);
  assert.throws(() => store.update(first.participant_id, { version: 1, contact: { ...contact, mobile: '000-3333-3333' } }, 1));
  assert.deepEqual(store.detail(first.participant_id), before); db.close();
});
