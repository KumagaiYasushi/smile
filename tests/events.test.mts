import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { AuthStore } from '../lib/auth-store.ts';
import { EventStore, EventError, relativeDate } from '../lib/event-store.ts';

const template = { family: 'BASIC_COURSE', title: '架空の準備', relative_days: -30, phase: 'PREPARATION', important: true, active: true };
const input = { type: 'BASIC_COURSE', title: '架空のベーシックコース', owner_id: 1, sessions: [
  { starts_at: '2028-03-01T10:00+09:00', ends_at: '2028-03-01T17:00+09:00' },
  { starts_at: '2028-04-01T10:00+09:00', ends_at: '2028-04-01T17:00+09:00' },
] };
function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys = ON');
  const auth = new AuthStore(db, randomBytes(32));
  auth.createUser('a@example.invalid', '架空管理者A', 'only-fictional-password-a');
  auth.createUser('b@example.invalid', '架空管理者B', 'only-fictional-password-b');
  return { db, store: new EventStore(db) };
}
function rejectsStatus(action: () => unknown, status: number) {
  assert.throws(action, error => error instanceof EventError && error.status === status);
}

test('AT01: event, sorted sessions and relative template tasks are generated atomically', () => {
  const { db, store } = fixture();
  store.saveTemplate(template, 1);
  store.saveTemplate({ ...template, title: '架空のお礼', relative_days: 7, phase: 'FOLLOWUP', important: false }, 1);
  const event = store.create({ ...input, sessions: [...input.sessions].reverse() }, 1);
  assert.equal(event.sessions.length, 2);
  assert.equal(event.sessions[0].starts_at, '2028-03-01T01:00:00.000Z');
  assert.deepEqual(event.tasks.map(task => task.due_on), ['2028-01-31', '2028-03-08']);
  assert.equal(event.tasks[0].assignee_id, null);
  assert.equal(event.tasks[0].important, true);
  assert.equal(event.tasks[1].phase, 'FOLLOWUP');
  assert.equal(store.history(event.id).length, 1);
  db.close();
});

test('lecture/seminar share templates; basic and inactive templates are excluded', () => {
  const { db, store } = fixture();
  store.saveTemplate(template, 1);
  store.saveTemplate({ ...template, family: 'LECTURE_SEMINAR', title: '講演共通' }, 1);
  store.saveTemplate({ ...template, family: 'LECTURE_SEMINAR', title: '停止中', active: false }, 1);
  for (const type of ['LECTURE', 'SEMINAR']) assert.deepEqual(store.create({ ...input, type }, 1).tasks.map(task => task.title), ['講演共通']);
  assert.equal(store.create(input, 1).tasks[0].title, template.title);
  db.close();
});

test('template changes only affect future events, and stale template edits are rejected', () => {
  const { db, store } = fixture();
  const initial = store.saveTemplate(template, 1);
  const old = store.create(input, 1);
  store.saveTemplate({ ...template, relative_days: -10, version: initial.version }, 1, initial.id);
  assert.equal(store.get(old.id).tasks[0].due_on, '2028-01-31');
  assert.equal(store.create(input, 1).tasks[0].due_on, '2028-02-20');
  rejectsStatus(() => store.saveTemplate({ ...template, version: initial.version }, 1, initial.id), 409);
  db.close();
});

test('task states, owner, collaborators, importance and manual deadline persist with safe audit', () => {
  const { db, store } = fixture(); store.saveTemplate(template, 1);
  const event = store.create(input, 1);
  let task = event.tasks[0];
  for (const status of ['IN_PROGRESS', 'REVIEW', 'DONE', 'TODO']) task = store.updateTask(task.id, {
    version: task.version, status, assignee_id: 1, collaborator_ids: [2, 2], important: false, due_on: '2028-02-11',
  }, 2);
  assert.deepEqual(task.collaborator_ids, [2]); assert.equal(task.due_mode, 'MANUAL');
  assert.equal(task.status, 'TODO'); assert.equal(task.assignee_id, 1); assert.equal(task.important, false);
  const changed = store.updateOwner(event.id, { owner_id: 2, version: event.version }, 1);
  assert.equal(changed.owner_id, 2);
  rejectsStatus(() => store.updateOwner(event.id, { owner_id: 1, version: event.version }, 1), 409);
  const logs = store.history(event.id); assert.equal(logs.length, 6);
  assert(!JSON.stringify(logs).includes(input.title));
  assert(!JSON.stringify(logs).includes(template.title));
  db.close();
});

test('invalid/stale task updates do not partially overwrite collaborators or history', () => {
  const { db, store } = fixture(); store.saveTemplate(template, 1);
  const event = store.create(input, 1), task = event.tasks[0];
  rejectsStatus(() => store.updateTask(task.id, { version: task.version, status: 'INVALID' }, 1), 400);
  rejectsStatus(() => store.updateTask(task.id, { version: task.version, assignee_id: 1, collaborator_ids: [1] }, 1), 400);
  rejectsStatus(() => store.updateTask(task.id, { version: task.version, collaborator_ids: [999] }, 1), 400);
  assert.deepEqual(store.get(event.id).tasks[0], task);
  const updated = store.updateTask(task.id, { version: task.version, status: 'REVIEW' }, 1);
  rejectsStatus(() => store.updateTask(task.id, { version: task.version, status: 'DONE' }, 1), 409);
  assert.deepEqual(store.get(event.id).tasks[0], updated);
  db.close();
});

test('schedule preview flags exceptions and never changes dates, tasks or audit; PATCH refuses dates', () => {
  const { db, store } = fixture(); store.saveTemplate(template, 1);
  const event = store.create(input, 1);
  store.updateTask(event.tasks[0].id, { version: 1, status: 'DONE' }, 1);
  store.addTask(event.id, { title: '個別タスク', due_on: '2028-02-05', phase: 'PREPARATION', important: true }, 1);
  const before = store.get(event.id), history = store.history(event.id);
  const preview = store.preview(event.id, { sessions: [{ starts_at: '2028-03-11T10:00+09:00', ends_at: '2028-03-11T17:00+09:00' }] });
  assert.equal(preview.can_apply, false);
  assert(preview.changes.every(row => row.needs_decision));
  assert.equal(preview.changes.find(row => row.id === event.tasks[0].id)?.proposed, '2028-02-10');
  assert.deepEqual(store.get(event.id), before); assert.deepEqual(store.history(event.id), history);
  rejectsStatus(() => store.updateOwner(event.id, { owner_id: 1, version: 1, sessions: input.sessions }, 1), 400);
  db.close();
});

test('JST date arithmetic crosses UTC date, leap day and year boundaries correctly', () => {
  assert.equal(relativeDate('2027-12-31T15:00:00Z', -1), '2027-12-31');
  assert.equal(relativeDate('2028-02-29T15:00:00Z', -1), '2028-02-29');
  assert.equal(relativeDate('2028-12-31T15:00:00Z', 1), '2029-01-02');
});

test('invalid dates, times, session overlaps, owners and missing templates do not create events', () => {
  const { db, store } = fixture();
  rejectsStatus(() => store.create(input, 1), 400); assert.equal(store.list().length, 0);
  store.saveTemplate(template, 1);
  for (const starts_at of ['2028-02-30T10:00+09:00', '2028-03-01T24:00+09:00', '2028-03-01T10:00']) {
    rejectsStatus(() => store.create({ ...input, sessions: [{ starts_at, ends_at: '2028-03-02T17:00+09:00' }] }, 1), 400);
  }
  rejectsStatus(() => store.create({ ...input, sessions: [input.sessions[0], input.sessions[0]] }, 1), 400);
  rejectsStatus(() => store.create({ ...input, owner_id: 99 }, 1), 400);
  rejectsStatus(() => store.create({ ...input, type: 'UNKNOWN' }, 1), 400);
  db.prepare('UPDATE users SET active=0 WHERE id=2').run();
  rejectsStatus(() => store.create({ ...input, owner_id: 2 }, 1), 400);
  assert.equal(store.list().length, 0);
  db.close();
});

test('audit write failure rolls back event, sessions and generated tasks', () => {
  const { db, store } = fixture(); store.saveTemplate(template, 1);
  db.exec("CREATE TRIGGER reject_event_audit BEFORE INSERT ON event_audit_logs WHEN NEW.event_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'test rollback'); END;");
  assert.throws(() => store.create(input, 1));
  for (const table of ['events', 'event_sessions', 'tasks']) assert.equal((db.prepare(`SELECT count(*) as n FROM ${table}`).get() as { n: number }).n, 0);
  db.close();
});
