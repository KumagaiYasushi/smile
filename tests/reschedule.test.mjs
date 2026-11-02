import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createTaskStore } from '../lib/tasks.ts';
import { createTemplateStore } from '../lib/task-templates.ts';
import { createRescheduleStore } from '../lib/reschedule.ts';
import { parseScheduleInput } from '../types/reschedule.ts';

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY,event_type TEXT,dates TEXT,venue TEXT);
    INSERT INTO seminars VALUES(1,'SEMINAR','["2027-01-01"]','original'),(2,'SEMINAR','[]','other');
    CREATE TABLE auth_users(id INTEGER PRIMARY KEY,email TEXT,active INTEGER);
    INSERT INTO auth_users VALUES(1,'test@example.invalid',1),(2,'inactive@example.invalid',0);`);
  const templates = createTemplateStore(db);
  templates.createTemplate({ event_type: 'SEMINAR', title: 'Private schedule task marker', relative_days: -30, important: true }, 1);
  templates.createTemplate({ event_type: 'SEMINAR', title: 'completed task', relative_days: -7 }, 1);
  const plan = templates.preview(1);
  const generated = templates.apply(1, plan.base_date, plan.preview_token, 1);
  const tasks = createTaskStore(db);
  const manual = tasks.createTask(1, { title: 'manual', due_date: '2027-01-05', assignee_id: 1, collaborator_ids: [1] }, 1);
  const store = createRescheduleStore(db);
  const update = (dates) => db.prepare('UPDATE seminars SET dates=? WHERE id=1').run(JSON.stringify(dates));
  const request = (preview, decisions) => ({ dates: preview.new_dates, base_date: preview.base_date, preview_token: preview.preview_token, decisions });
  return { db, templates, tasks, store, generated, manual, update, request };
}
const keep = (preview) => preview.items.map((item) => ({ task_id: item.task_id, action: 'keep' }));

test('per-task decisions update selected deadlines, preserve completed tasks and allow custom manual deadlines', () => {
  const { db, tasks, store, generated, manual, update, request } = fixture();
  try {
    const done = tasks.updateTask(1, generated.task_ids[1], { status: 'DONE', due_date: '2027-01-10' }, 1, 1);
    const preview = store.preview(1, { dates: ['2027-02-01'] });
    assert.equal(preview.items.find((item) => item.task_id === done.id).manually_changed, true);
    assert.equal(preview.items.find((item) => item.task_id === generated.task_ids[0]).proposed_due_date, '2027-01-02');
    const result = store.apply(1, request(preview, [
      { task_id: generated.task_ids[0], action: 'proposed' }, { task_id: done.id, action: 'keep' },
      { task_id: manual.id, action: 'custom', due_date: '2027-02-05' },
    ]), 1, update);
    assert.equal(result.history.updated_task_ids.length, 2);
    assert.equal(tasks.getTask(1, done.id).status, 'DONE');
    assert.equal(tasks.getTask(1, done.id).due_date, '2027-01-10');
    assert.equal(tasks.getTask(1, manual.id).due_date, '2027-02-05');
    assert.equal(tasks.getTask(1, manual.id).assignee_id, 1);
    assert.deepEqual(tasks.getTask(1, manual.id).collaborator_ids, [1]);
    assert.equal(tasks.getTask(1, generated.task_ids[0]).important, true);
    assert.equal(db.prepare('SELECT dates FROM seminars WHERE id=1').get().dates, '["2027-02-01"]');
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM event_schedule_history').all()).includes('Private'));
    assert.equal(store.history(1)[0].actor_id, 1);
  } finally { db.close(); }
});

test('every task requires an explicit decision; manual tasks cannot silently use a proposed deadline', () => {
  const { db, store, manual, update, request } = fixture();
  try {
    const preview = store.preview(1, { dates: ['2027-02-01'] });
    assert.throws(() => store.apply(1, request(preview, []), 1, update), { status: 400 });
    assert.throws(() => store.apply(1, request(preview, [...keep(preview), { task_id: 999, action: 'keep' }]), 1, update), { status: 400 });
    const invalid = keep(preview).map((item) => item.task_id === manual.id ? { ...item, action: 'proposed' } : item);
    assert.throws(() => store.apply(1, request(preview, invalid), 1, update), { status: 400 });
    assert.equal(store.history(1).length, 0);
    assert.equal(db.prepare('SELECT dates FROM seminars WHERE id=1').get().dates, '["2027-01-01"]');
    assert.throws(() => store.apply(1, request(preview, keep(preview)), 2, update), { status: 403 });
  } finally { db.close(); }
});

test('task edits, additions and deletions invalidate prior previews', () => {
  const { db, store, tasks, manual, update, request } = fixture();
  try {
    let preview = store.preview(1, { dates: ['2027-02-01'] });
    tasks.updateTask(1, manual.id, { status: 'IN_REVIEW' }, manual.version, 1);
    assert.throws(() => store.apply(1, request(preview, keep(preview)), 1, update), { status: 409 });
    preview = store.preview(1, { dates: ['2027-02-01'] });
    const added = tasks.createTask(1, { title: 'new after preview' }, 1);
    assert.throws(() => store.apply(1, request(preview, keep(preview)), 1, update), { status: 409 });
    preview = store.preview(1, { dates: ['2027-02-01'] });
    tasks.deleteTask(1, added.id, added.version, 1);
    assert.throws(() => store.apply(1, request(preview, keep(preview)), 1, update), { status: 409 });
    assert.equal(store.history(1).length, 0);
  } finally { db.close(); }
});

test('failure to save schedule audit rolls back event dates, tasks, source bases and task audit', () => {
  const { db, store, tasks, generated, update, request } = fixture();
  try {
    const before = tasks.getTask(1, generated.task_ids[0]);
    const auditCount = db.prepare('SELECT count(*) n FROM task_history').get().n;
    const preview = store.preview(1, { dates: ['2027-02-01'] });
    db.exec("CREATE TRIGGER reject_schedule_audit BEFORE INSERT ON event_schedule_history BEGIN SELECT RAISE(ABORT,'schedule audit unavailable'); END;");
    const decisions = keep(preview).map((item) => item.task_id === before.id ? { ...item, action: 'proposed' } : item);
    assert.throws(() => store.apply(1, request(preview, decisions), 1, update), /schedule audit unavailable/);
    assert.deepEqual(tasks.getTask(1, before.id), before);
    assert.equal(db.prepare('SELECT dates FROM seminars WHERE id=1').get().dates, '["2027-01-01"]');
    assert.equal(db.prepare('SELECT base_date FROM task_template_applications WHERE task_id=?').get(before.id).base_date, '2027-01-01');
    assert.equal(db.prepare('SELECT count(*) n FROM task_history').get().n, auditCount);
    assert.equal(db.prepare('SELECT revision FROM event_schedule_state WHERE seminar_id=1').get().revision, 0);
  } finally { db.close(); }
});

test('retries return the original result without another update, and changed selections cannot reuse approval', () => {
  const { db, store, generated, update, request } = fixture();
  try {
    const preview = store.preview(1, { dates: ['2027-02-01'] });
    const choices = keep(preview).map((item) => item.task_id === generated.task_ids[0] ? { ...item, action: 'proposed' } : item);
    const payload = request(preview, choices);
    const first = store.apply(1, payload, 1, update);
    const auditCount = db.prepare('SELECT count(*) n FROM task_history').get().n;
    const retry = store.apply(1, payload, 1, update);
    assert.deepEqual(retry.history, first.history);
    assert.equal(retry.replayed, true);
    assert.equal(db.prepare('SELECT count(*) n FROM task_history').get().n, auditCount);
    assert.equal(store.history(1).length, 1);
    assert.throws(() => store.apply(1, request(preview, keep(preview)), 1, update), { status: 409 });
  } finally { db.close(); }
});

test('subsequent proposals use saved generation offsets, not newly edited templates; completed tasks may be explicitly updated', () => {
  const { db, store, templates, tasks, generated, update, request } = fixture();
  try {
    const id = generated.task_ids[0];
    tasks.updateTask(1, id, { status: 'DONE' }, 1, 1);
    const first = store.preview(1, { dates: ['2027-02-01'] });
    store.apply(1, request(first, keep(first).map((item) => item.task_id === id ? { ...item, action: 'proposed' } : item)), 1, update);
    assert.equal(tasks.getTask(1, id).status, 'DONE');
    const template = templates.listTemplates()[0];
    templates.updateTemplate(template.id, { relative_days: -1 }, template.version, 1);
    const next = store.preview(1, { dates: ['2027-03-01'] });
    const proposal = next.items.find((item) => item.task_id === id);
    assert.equal(proposal.source_base_date, '2027-02-01');
    assert.equal(proposal.manually_changed, false);
    assert.equal(proposal.proposed_due_date, '2027-01-30');
  } finally { db.close(); }
});

test('multi-day and undated events require no assumed anchor; users can retain all or clear a deadline explicitly', () => {
  const { db, store, tasks, manual, update, request } = fixture();
  try {
    const multi = store.preview(1, { dates: ['2027-03-01','2027-04-01'] });
    assert.equal(multi.base_date, null);
    assert.ok(multi.items.every((item) => item.proposed_due_date === null));
    const selected = store.preview(1, { dates: ['2027-03-01','2027-04-01'], base_date: '2027-04-01' });
    assert.equal(selected.items[0].proposed_due_date, '2027-03-02');
    const empty = store.preview(1, { dates: [] });
    const decisions = keep(empty).map((item) => item.task_id === manual.id ? { task_id: manual.id, action: 'custom', due_date: null } : item);
    store.apply(1, request(empty, decisions), 1, update);
    assert.equal(tasks.getTask(1, manual.id).due_date, null);
    assert.equal(db.prepare('SELECT dates FROM seminars WHERE id=1').get().dates, '[]');
  } finally { db.close(); }
});

test('event changes invalidate previews; unrelated event fields are preserved and callbacks must actually persist dates', () => {
  const { db, store, update, request } = fixture();
  try {
    let preview = store.preview(1, { dates: ['2027-02-01'] });
    db.prepare("UPDATE seminars SET event_type='LECTURE' WHERE id=1").run();
    assert.throws(() => store.apply(1, request(preview, keep(preview)), 1, update), { status: 409 });
    preview = store.preview(1, { dates: ['2027-02-01'] });
    assert.throws(() => store.apply(1, request(preview, keep(preview)), 1, () => {}), /not persisted/);
    db.prepare("UPDATE seminars SET venue='changed elsewhere' WHERE id=1").run();
    store.apply(1, request(preview, keep(preview)), 1, update);
    assert.equal(db.prepare('SELECT venue FROM seminars WHERE id=1').get().venue, 'changed elsewhere');
    assert.throws(() => store.preview(999, { dates: [] }), { status: 404 });
  } finally { db.close(); }
});

test('date and decision validation rejects malformed input, duplicates and hidden field changes', () => {
  for (const input of [null, [], { dates: null }, { dates: ['2027-02-29'] }, { dates: ['2027-01-01','2027-01-01'] },
    { dates: ['2027-01-01'], base_date: '2027-02-01' }, { dates: [], actor_id: 1 }]) {
    assert.throws(() => parseScheduleInput(input), { status: 400 });
  }
  const base = { dates: ['2027-01-01'], preview_token: 'a'.repeat(64) };
  for (const decisions of [[{ task_id: 1, action: 'skip' }], [{ task_id: 1, action: 'custom' }],
    [{ task_id: 1, action: ['keep'] }], [{ task_id: 1, action: {} }],
    [{ task_id: 1, action: 'custom', due_date: '2027-02-29' }], [{ task_id: 1, action: 'keep', due_date: null }],
    [{ task_id: 1, action: 'keep' }, { task_id: 1, action: 'keep' }]]) {
    assert.throws(() => parseScheduleInput({ ...base, decisions }, true), { status: 400 });
  }
});
