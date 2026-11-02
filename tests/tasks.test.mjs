import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createTaskStore } from '../lib/tasks.ts';
import { isTaskOverdue, parseId, parseTaskInput, parseVersion, todayInTokyo } from '../types/task.ts';

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY,name TEXT);
    INSERT INTO seminars VALUES(42,'架空イベント'),(43,'別の架空イベント');
    CREATE TABLE auth_users(id INTEGER PRIMARY KEY,email TEXT,active INTEGER);
    INSERT INTO auth_users VALUES(1,'first@example.invalid',1),(2,'second@example.invalid',1),(3,'disabled@example.invalid',0);`);
  return { db, store: createTaskStore(db) };
}

test('task schema can be initialized repeatedly; tasks support main assignee and multiple collaborators', () => {
  const { db, store } = fixture();
  try {
    const task = store.createTask(42, { title: ' 架空タスク ', due_date: '2027-01-01', assignee_id: 1, collaborator_ids: [1, 2], important: true }, 1);
    createTaskStore(db);
    assert.equal(task.title, '架空タスク');
    assert.equal(task.status, 'NOT_STARTED');
    assert.deepEqual(task.collaborator_ids, [1, 2]);
    assert.equal(store.getTask(42, task.id).due_date, '2027-01-01');
    assert.equal(store.listTasks(43).length, 0);
    assert.equal(db.prepare('SELECT name FROM seminars WHERE id=42').get().name, '架空イベント');
  } finally { db.close(); }
});

test('invalid inputs, nonexistent events and inactive members fail without partial writes', () => {
  const { db, store } = fixture();
  try {
    const invalid = [null, [], 'bad', {}, { title: ' ' }, { title: 'x'.repeat(201) },
      { title: 'x', description: 'x'.repeat(2001) }, { title: 'x', due_date: '2026-02-30' },
      { title: 'x', due_date: '2027-01-01T00:00Z' }, { title: 'x', status: 'toString' },
      { title: 'x', important: 'false' }, { title: 'x', assignee_id: [1,2] },
      { title: 'x', collaborator_ids: [1,1] }, { title: 'x', collaborator_ids: [0] },
      { title: 'x', actor_id: 1 }, { title: 'x', assignee_id: 999 }, { title: 'x', collaborator_ids: [1,3] }];
    for (const input of invalid) assert.throws(() => store.createTask(42, input, 1), { status: 400 });
    assert.throws(() => store.createTask(999, { title: 'x' }, 1), { status: 404 });
    assert.throws(() => store.createTask(42, { title: 'x' }, 3), { status: 403 });
    assert.equal(db.prepare('SELECT count(*) n FROM event_tasks').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM task_history').get().n, 0);
  } finally { db.close(); }
});

test('state changes, partial edits and optimistic versions preserve deadlines and reject lost updates', () => {
  const { db, store } = fixture();
  try {
    let task = store.createTask(42, { title: 'x', due_date: '2027-01-01', assignee_id: 1 }, 1);
    for (const status of ['IN_PROGRESS','IN_REVIEW','DONE','NOT_STARTED']) {
      task = store.updateTask(42, task.id, { status }, task.version, 2);
      assert.equal(task.status, status);
      assert.equal(task.assignee_id, 1);
      assert.equal(task.due_date, '2027-01-01');
    }
    const before = store.history(42, task.id).length;
    assert.throws(() => store.updateTask(42, task.id, { title: 'stale' }, 1, 1), { status: 409 });
    assert.throws(() => store.deleteTask(42, task.id, 1, 1), { status: 409 });
    assert.equal(store.history(42, task.id).length, before);
    assert.equal(store.getTask(42, task.id).title, 'x');
    assert.throws(() => store.getTask(43, task.id), { status: 404 });
    assert.throws(() => store.updateTask(43, task.id, { status: 'DONE' }, task.version, 1), { status: 404 });
    assert.throws(() => store.deleteTask(43, task.id, task.version, 1), { status: 404 });
  } finally { db.close(); }
});

test('task and collaborator edits roll back if audit persistence fails', () => {
  const { db, store } = fixture();
  try {
    const task = store.createTask(42, { title: 'original', collaborator_ids: [1] }, 1);
    db.exec("CREATE TRIGGER reject_audit BEFORE INSERT ON task_history BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
    assert.throws(() => store.updateTask(42, task.id, { title: 'changed', collaborator_ids: [2] }, 1, 1), /audit unavailable/);
    assert.deepEqual(store.getTask(42, task.id), task);
    assert.throws(() => store.createTask(42, { title: 'new' }, 1), /audit unavailable/);
    assert.equal(store.listTasks(42).length, 1);
    assert.throws(() => store.deleteTask(42, task.id, 1, 1), /audit unavailable/);
    assert.equal(store.history(42, task.id).length, 1);
  } finally { db.close(); }
});

test('history captures deadline, actor, state and assignment changes without saving free text; deletions clean relations', () => {
  const { db, store } = fixture();
  try {
    const task = store.createTask(42, { title: 'Private free text marker', description: 'Private description marker', collaborator_ids: [2] }, 1);
    const updated = store.updateTask(42, task.id, { due_date: '2027-02-01', assignee_id: 2, important: true }, 1, 2);
    const history = store.history(42, task.id);
    assert.equal(history[0].actor_id, 2);
    assert.equal(history[0].before.due_date, null);
    assert.equal(history[0].after.due_date, '2027-02-01');
    assert.equal(history[0].after.assignee_id, 2);
    assert.ok(!JSON.stringify(history).includes('Private'));
    store.deleteTask(42, task.id, updated.version, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM task_collaborators').get().n, 0);
    assert.equal(db.prepare("SELECT count(*) n FROM task_history WHERE action='deleted'").get().n, 1);
    const other = store.createTask(42, { title: 'cascade', collaborator_ids: [2] }, 1);
    db.prepare('DELETE FROM seminars WHERE id=42').run();
    assert.equal(db.prepare('SELECT count(*) n FROM event_tasks WHERE id=?').get(other.id).n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM task_collaborators').get().n, 0);
    assert.ok(db.prepare('SELECT count(*) n FROM task_history').get().n > 0);
  } finally { db.close(); }
});

test('deactivation does not prevent unrelated task edits, while new inactive assignments are rejected', () => {
  const { db, store } = fixture();
  try {
    const task = store.createTask(42, { title: 'x', assignee_id: 2, collaborator_ids: [2] }, 1);
    db.prepare('UPDATE auth_users SET active=0 WHERE id=2').run();
    const updated = store.updateTask(42, task.id, { title: 'edited', assignee_id: 2, collaborator_ids: [2] }, 1, 1);
    assert.equal(updated.title, 'edited');
    assert.equal(store.listMembers().length, 1);
    assert.throws(() => store.updateTask(42, task.id, { collaborator_ids: [2,3] }, updated.version, 1), { status: 400 });
    assert.throws(() => store.updateTask(42, task.id, { status: 'DONE' }, updated.version, 2), { status: 403 });
  } finally { db.close(); }
});

test('due-date alerts use the Japanese calendar day and exclude completed or undated tasks', () => {
  assert.equal(todayInTokyo(new Date('2026-11-01T15:00:00Z')), '2026-11-02');
  assert.equal(todayInTokyo(new Date('2026-11-01T14:59:59Z')), '2026-11-01');
  assert.equal(isTaskOverdue({ due_date: '2026-11-01', status: 'IN_REVIEW' }, '2026-11-02'), true);
  assert.equal(isTaskOverdue({ due_date: '2026-11-02', status: 'NOT_STARTED' }, '2026-11-02'), false);
  assert.equal(isTaskOverdue({ due_date: '2026-11-01', status: 'DONE' }, '2026-11-02'), false);
  assert.equal(isTaskOverdue({ due_date: null, status: 'IN_PROGRESS' }, '2026-11-02'), false);
  assert.equal(parseTaskInput({ title: 'x', due_date: '2028-02-29' }).due_date, '2028-02-29');
  assert.throws(() => parseTaskInput({ title: 'x', due_date: '2027-02-29' }), { status: 400 });
  assert.throws(() => parseTaskInput({}, true), { status: 400 });
  for (const value of ['1e2', '-1', '0', '1.5', '9007199254740992']) assert.throws(() => parseId(value), { status: 400 });
  for (const value of [null, '1', 0, 1.2]) assert.throws(() => parseVersion(value), { status: 400 });
});
