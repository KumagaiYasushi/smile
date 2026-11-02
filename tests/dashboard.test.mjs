import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createTaskStore } from '../lib/tasks.ts';
import { createDashboardStore } from '../lib/dashboard.ts';
import { parseDashboardQuery } from '../types/dashboard.ts';

const now = new Date('2026-11-01T15:00:00Z'); // 2026-11-02 in Japan
const query = (filter = 'ALL', days = 7, page = 1) => ({ filter, days, page });
function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY,name TEXT,event_type TEXT);
    INSERT INTO seminars VALUES(1,'First','SEMINAR'),(2,'Second','LECTURE'),(3,'Empty','BASIC_COURSE');
    CREATE TABLE auth_users(id INTEGER PRIMARY KEY,email TEXT,active INTEGER);
    INSERT INTO auth_users VALUES(1,'first@example.invalid',1),(2,'second@example.invalid',1),(3,'former@example.invalid',1);`);
  const tasks = createTaskStore(db);
  const dashboard = createDashboardStore(db);
  const add = (seminar, title, fields) => tasks.createTask(seminar, { title, ...fields }, 1);
  return { db, tasks, dashboard, add };
}
function seed(add, db) {
  const overdue = add(1, 'overdue', { due_date: '2026-11-01', important: true, status: 'IN_PROGRESS' });
  const review = add(1, 'review', { due_date: '2026-11-02', status: 'IN_REVIEW', important: true, assignee_id: 1, collaborator_ids: [1,2] });
  const boundary = add(2, 'boundary', { due_date: '2026-11-09', important: true, assignee_id: 2, collaborator_ids: [1] });
  const beyond = add(2, 'beyond', { due_date: '2026-11-10', important: true, assignee_id: 2 });
  const undated = add(1, 'undated', { important: true, assignee_id: 1 });
  const done = add(2, 'done', { due_date: '2026-11-01', important: true, status: 'DONE', assignee_id: 1, collaborator_ids: [1] });
  const otherReview = add(2, 'other review', { due_date: '2026-11-05', status: 'IN_REVIEW' });
  const former = add(1, 'former', { due_date: '2026-11-06', assignee_id: 3 });
  db.prepare('UPDATE auth_users SET active=0 WHERE id=3').run();
  return { overdue, review, boundary, beyond, undated, done, otherReview, former };
}

test('dashboard aggregates open tasks across events and returns consistent category counts', () => {
  const { db, dashboard, add } = fixture();
  try {
    const ids = seed(add, db);
    const result = dashboard.getDashboard(1, query(), now);
    assert.equal(result.event_count, 3);
    assert.deepEqual(result.counts, { ALL: 7, OVERDUE: 1, IN_REVIEW: 2, UNASSIGNED: 2, IMPORTANT: 2, MINE: 3 });
    assert.equal(result.total, 7);
    assert.deepEqual(result.items.map((item) => item.id), [ids.overdue.id, ids.review.id, ids.otherReview.id, ids.former.id, ids.boundary.id, ids.beyond.id, ids.undated.id]);
    assert.ok(!result.items.some((item) => item.id === ids.done.id));
    assert.equal(result.items.find((item) => item.id === ids.former.id).assignee.active, false);
    assert.equal(result.items.find((item) => item.id === ids.boundary.id).seminar_name, 'Second');
    for (const filter of ['ALL','OVERDUE','IN_REVIEW','UNASSIGNED','IMPORTANT','MINE']) {
      const selected = dashboard.getDashboard(1, query(filter), now);
      assert.equal(selected.items.length, selected.counts[filter]);
      assert.deepEqual(selected.counts, result.counts);
    }
  } finally { db.close(); }
});

test('personal tasks use the actual actor and count primary/collaborator membership only once', () => {
  const { db, dashboard, add } = fixture();
  try {
    const ids = seed(add, db);
    const first = dashboard.getDashboard(1, query('MINE'), now);
    const second = dashboard.getDashboard(2, query('MINE'), now);
    assert.deepEqual(new Set(first.items.map((item) => item.id)), new Set([ids.review.id, ids.boundary.id, ids.undated.id]));
    assert.deepEqual(new Set(second.items.map((item) => item.id)), new Set([ids.review.id, ids.boundary.id, ids.beyond.id]));
    assert.equal(first.items.find((item) => item.id === ids.review.id).is_primary, true);
    assert.equal(first.items.find((item) => item.id === ids.review.id).is_collaborator, true);
    assert.equal(first.items.find((item) => item.id === ids.boundary.id).is_primary, false);
    assert.throws(() => dashboard.getDashboard(3, query(), now), { status: 403 });
    assert.throws(() => dashboard.getDashboard(999, query(), now), { status: 403 });
  } finally { db.close(); }
});

test('upcoming important tasks include today and the selected final day, excluding overdue, undated and completed', () => {
  const { db, dashboard, add } = fixture();
  try {
    const ids = seed(add, db);
    const short = dashboard.getDashboard(1, query('IMPORTANT', 3), now);
    assert.deepEqual(short.items.map((item) => item.id), [ids.review.id]);
    const week = dashboard.getDashboard(1, query('IMPORTANT', 7), now);
    assert.deepEqual(week.items.map((item) => item.id), [ids.review.id, ids.boundary.id]);
    assert.equal(week.through_date, '2026-11-09');
    const month = dashboard.getDashboard(1, query('IMPORTANT', 30), now);
    assert.equal(month.items.length, 3);
    assert.ok(!month.items.some((item) => [ids.overdue.id, ids.done.id, ids.undated.id].includes(item.id)));
  } finally { db.close(); }
});

test('date classification switches at midnight in Japan, independent of the process timezone', () => {
  const { db, dashboard, add } = fixture();
  try {
    const ids = seed(add, db);
    const before = dashboard.getDashboard(1, query('OVERDUE'), new Date('2026-11-01T14:59:59Z'));
    const after = dashboard.getDashboard(1, query('OVERDUE'), new Date('2026-11-01T15:00:00Z'));
    assert.equal(before.as_of_date, '2026-11-01');
    assert.equal(before.total, 0);
    assert.equal(after.as_of_date, '2026-11-02');
    assert.deepEqual(after.items.map((item) => item.id), [ids.overdue.id]);
  } finally { db.close(); }
});

test('pagination is stable, counts are not truncated, and an obsolete page number is clamped', () => {
  const { db, dashboard, add } = fixture();
  try {
    for (let i = 0; i < 55; i++) add(i % 2 ? 1 : 2, `task ${i}`, {});
    const first = dashboard.getDashboard(1, query(), now);
    const second = dashboard.getDashboard(1, query('ALL', 7, 2), now);
    assert.equal(first.total, 55);
    assert.equal(first.items.length, 50);
    assert.equal(second.items.length, 5);
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 55);
    assert.equal(dashboard.getDashboard(1, query('ALL', 7, 999), now).page, 2);
    db.prepare('DELETE FROM seminars WHERE id IN (1,2)').run();
    const empty = dashboard.getDashboard(1, query('ALL', 7, 999), now);
    assert.equal(empty.page, 1);
    assert.equal(empty.event_count, 1);
    assert.deepEqual(empty.items, []);
    assert.ok(Object.values(empty.counts).every((count) => count === 0));
  } finally { db.close(); }
});

test('reading dashboard data leaves task data and business audit unchanged', () => {
  const { db, dashboard, add } = fixture();
  try {
    seed(add, db);
    const snapshot = () => JSON.stringify({ tasks: db.prepare('SELECT * FROM event_tasks ORDER BY id').all(), audit: db.prepare('SELECT * FROM task_history ORDER BY id').all() });
    const before = snapshot();
    dashboard.getDashboard(1, query(), now);
    dashboard.getDashboard(2, query('IMPORTANT', 30), now);
    assert.equal(snapshot(), before);
  } finally { db.close(); }
});

test('invalid filters, extra identity parameters and malformed pagination are rejected', () => {
  assert.deepEqual(parseDashboardQuery(new URLSearchParams()), query());
  for (const value of ['filter=toString', 'filter=ALL&filter=MINE', 'days=5', 'days=7.0', 'page=0', 'page=1e2', 'page=100001', 'user_id=2', 'actor=2', 'filter=ALL%27%20OR%201%3D1']) {
    assert.throws(() => parseDashboardQuery(new URLSearchParams(value)), { status: 400 });
  }
});
