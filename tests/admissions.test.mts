import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { AuthStore } from '../lib/auth-store.ts';
import { EventError, EventStore } from '../lib/event-store.ts';
import { RegistrationStore } from '../lib/registration-store.ts';

function fixture(capacity: number | null = 1, deadline: string | null = null, file = ':memory:') {
  const db = new Database(file); db.pragma('foreign_keys = ON');
  if (file !== ':memory:') db.pragma('journal_mode = WAL');
  new AuthStore(db, randomBytes(32)).createUser('a@example.invalid', '架空の管理者', 'fictional-test-password-only');
  const events = new EventStore(db);
  events.saveTemplate({ family: 'LECTURE_SEMINAR', title: '架空タスク', relative_days: -7, phase: 'PREPARATION', important: false, active: true }, 1);
  const event = events.create({ type: 'SEMINAR', title: '架空の受付確認', owner_id: 1, capacity, application_deadline: deadline,
    sessions: [{ starts_at: '2028-03-01T10:00+09:00', ends_at: '2028-03-01T17:00+09:00' }] }, 1);
  let now = Date.parse('2027-01-01T00:00:00Z');
  const store = new RegistrationStore(db, () => now);
  const register = (name: string) => store.register(event.id, { request_key: randomUUID(), snapshot: { name, mobile: '000-0000-0000' } }, 1);
  return { db, store, event, register, setNow: (time: string) => { now = Date.parse(time); } };
}
function reject(action: () => unknown, status = 409) { assert.throws(action, error => error instanceof EventError && error.status === status); }

test('explicit review confirms one seat with actor/time; snapshot, payment and attendance are unchanged', () => {
  const { db, store, event, register } = fixture(); const registration = register('架空参加者');
  reject(() => store.confirm(registration.id, { reviewed: false, event_version: 1 }, 1), 400);
  const confirmed = store.confirm(registration.id, { reviewed: true, event_version: 1 }, 1);
  assert.equal(confirmed.application_status, 'CONFIRMED'); assert.equal(confirmed.confirmed_by, 1); assert(confirmed.confirmed_at);
  assert.equal(confirmed.attendance_status, 'UNVERIFIED'); assert.deepEqual(confirmed.snapshot, registration.snapshot);
  assert.equal(store.detail(registration.participant_id).registrations[0].application_status, 'CONFIRMED');
  assert.equal(store.forEvent(event.id)[0].application_status, 'CONFIRMED');
  assert.equal(store.admission(event.id).remaining, 0); assert.equal(store.admission(event.id).state, 'FULL');
  assert.equal(store.admissionHistory(event.id).length, 1); db.close();
});

test('full capacity rejects a different registration but repeated successful confirmation is idempotent', () => {
  const { db, store, event, register } = fixture(); const first = register('架空A'), second = register('架空B');
  const before = store.confirm(first.id, { reviewed: true, event_version: 1 }, 1);
  reject(() => store.confirm(second.id, { reviewed: true, event_version: 1 }, 1));
  assert.deepEqual(store.confirm(first.id, { reviewed: true, event_version: 1 }, 1), before);
  assert.equal(store.admissionHistory(event.id).length, 1); assert.equal(store.admission(event.id).pending_count, 1); db.close();
});

test('cutoff is exact: just before deadline succeeds, at/after deadline rejects; no late override', () => {
  const { db, store, event, register, setNow } = fixture(3, '2027-01-01T09:00:00+09:00');
  const first = register('架空A'), second = register('架空B');
  setNow('2026-12-31T23:59:59.999Z'); store.confirm(first.id, { reviewed: true, event_version: 1 }, 1);
  setNow('2027-01-01T00:00:00.000Z'); reject(() => store.confirm(second.id, { reviewed: true, event_version: 1 }, 1));
  setNow('2027-01-01T01:00:00.000Z'); reject(() => store.confirm(second.id, { reviewed: true, event_version: 1 }, 1));
  assert.equal(store.confirm(first.id, { reviewed: true, event_version: 1 }, 1).application_status, 'CONFIRMED');
  assert.equal(store.admission(event.id).state, 'DEADLINE_PASSED'); assert.equal(store.admission(event.id).confirmed_count, 1); db.close();
});

test('null capacity blocks confirmation; setting capacity requires current version and records safe audit', () => {
  const { db, store, event, register } = fixture(null); const registration = register('架空A');
  reject(() => store.confirm(registration.id, { reviewed: true, event_version: 1 }, 1));
  assert.equal(store.admission(event.id).state, 'UNCONFIGURED');
  const updated = store.setCapacity(event.id, { capacity: 2, event_version: 1 }, 1);
  reject(() => store.confirm(registration.id, { reviewed: true, event_version: 1 }, 1));
  store.confirm(registration.id, { reviewed: true, event_version: updated.event_version }, 1);
  const logs = JSON.stringify(store.admissionHistory(event.id));
  assert(!logs.includes(registration.snapshot.name)); assert(!logs.includes(registration.snapshot.mobile)); db.close();
});

test('same participant cannot consume multiple seats through different registrations', () => {
  const { db, store, event, register } = fixture(3); const first = register('架空A'), second = register('架空A');
  assert.equal(first.participant_id, second.participant_id);
  store.confirm(first.id, { reviewed: true, event_version: 1 }, 1);
  reject(() => store.confirm(second.id, { reviewed: true, event_version: 1 }, 1));
  assert.equal(store.admission(event.id).confirmed_count, 1); db.close();
});

test('capacity cannot be reduced below confirmed seats and stale capacity edits do not overwrite', () => {
  const { db, store, event, register } = fixture(3);
  for (const name of ['架空A', '架空B']) store.confirm(register(name).id, { reviewed: true, event_version: 1 }, 1);
  reject(() => store.setCapacity(event.id, { capacity: 1, event_version: 1 }, 1));
  store.setCapacity(event.id, { capacity: 2, event_version: 1 }, 1);
  reject(() => store.setCapacity(event.id, { capacity: 4, event_version: 1 }, 1));
  assert.equal(store.admission(event.id).capacity, 2);
  assert.throws(() => db.prepare('UPDATE events SET capacity=1 WHERE id=?').run(event.id));
  assert.throws(() => db.prepare('UPDATE events SET capacity=NULL WHERE id=?').run(event.id)); db.close();
});

test('audit failure rolls back both seat allocation and capacity edits', () => {
  const { db, store, event, register } = fixture(2); const row = register('架空A');
  db.exec("CREATE TRIGGER fail_admission_audit BEFORE INSERT ON admission_audit_logs BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
  assert.throws(() => store.confirm(row.id, { reviewed: true, event_version: 1 }, 1));
  assert.equal(store.admission(event.id).confirmed_count, 0); assert.equal(store.getRegistration(row.id).application_status, 'PENDING_REVIEW');
  assert.throws(() => store.setCapacity(event.id, { capacity: 3, event_version: 1 }, 1));
  assert.equal(store.admission(event.id).capacity, 2); assert.equal(store.admission(event.id).event_version, 1); db.close();
});

test('additive migration from pending-only tables preserves existing snapshots/contacts and is repeatable', () => {
  const { db, store, register } = fixture(); const before = register('架空A');
  const detail = store.detail(before.participant_id);
  // Reproduce the preceding release: registrations/snapshots remain, admission tables do not.
  db.exec('DROP TRIGGER guard_confirmation_capacity; DROP TRIGGER guard_capacity_reduction; DROP TABLE admission_audit_logs; DROP TABLE registration_confirmations; DROP INDEX registrations_identity;');
  const again = new RegistrationStore(db);
  assert.deepEqual(again.getRegistration(before.id), before);
  assert.deepEqual(again.detail(before.participant_id), detail);
  assert.deepEqual(new RegistrationStore(db).getRegistration(before.id), before); db.close();
});

test('missing registrations, invalid payloads and inactive actors cannot confirm', () => {
  const { db, store, register } = fixture(); const row = register('架空A');
  reject(() => store.confirm(999, { reviewed: true, event_version: 1 }, 1), 404);
  reject(() => store.confirm(row.id, { reviewed: true, event_version: 1, override: true }, 1), 400);
  db.prepare('UPDATE users SET active=0 WHERE id=1').run();
  reject(() => store.confirm(row.id, { reviewed: true, event_version: 1 }, 1), 403); db.close();
});

test('two independent connections racing for the last seat produce exactly one confirmation', { timeout: 15000 }, async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'smile-admission-')), file = path.join(directory, 'test.db');
  const { db, store, event, register } = fixture(1, null, file);
  const first = register('架空A'), second = register('架空B');
  const workers: Worker[] = [];
  try {
    const outputs = [first, second].map(row => {
      const worker = new Worker(new URL('./admission-worker.mts', import.meta.url), { workerData: { path: file, id: row.id }, execArgv: ['--experimental-strip-types'] });
      workers.push(worker);
      return { ready: new Promise<void>((resolve, reject) => { worker.once('message', () => resolve()); worker.once('error', reject); }),
        result: new Promise<number>((resolve, reject) => { worker.on('message', message => { if (message.status) resolve(message.status); }); worker.once('error', reject); worker.on('exit', code => { if (code) reject(new Error('Worker exited')); }); }) };
    });
    await Promise.all(outputs.map(output => output.ready)); workers.forEach(worker => worker.postMessage('go'));
    assert.deepEqual((await Promise.all(outputs.map(output => output.result))).sort(), [200, 409]);
    assert.equal(store.admission(event.id).confirmed_count, 1); assert.equal(store.admissionHistory(event.id).length, 1);
  } finally { await Promise.all(workers.map(worker => worker.terminate())); db.close(); rmSync(directory, { recursive: true, force: true }); }
});
