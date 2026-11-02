import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createTemplateStore } from '../lib/task-templates.ts';
import { createTaskStore } from '../lib/tasks.ts';
import { parseTemplateInput, relativeDueDate } from '../types/task-template.ts';

function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY,event_type TEXT,dates TEXT);
    INSERT INTO seminars VALUES(1,'SEMINAR','["2027-01-01"]'),(2,'LECTURE','["2027-02-01"]'),(3,'BASIC_COURSE','["2027-03-01","2027-04-01"]');
    CREATE TABLE auth_users(id INTEGER PRIMARY KEY,email TEXT,active INTEGER);
    INSERT INTO auth_users VALUES(1,'test@example.invalid',1),(2,'disabled@example.invalid',0);`);
  const store = createTemplateStore(db);
  return { db, store, tasks: createTaskStore(db) };
}
const definition = { event_type: 'SEMINAR', title: '架空テンプレート', relative_days: -30 };

test('relative deadlines handle year boundaries, leap years and event-day/post-event tasks', () => {
  assert.equal(relativeDueDate('2027-01-01', -30), '2026-12-02');
  assert.equal(relativeDueDate('2028-03-01', -1), '2028-02-29');
  assert.equal(relativeDueDate('2027-03-01', -1), '2027-02-28');
  assert.equal(relativeDueDate('2027-01-01', 0), '2027-01-01');
  assert.equal(relativeDueDate('2027-01-01', 7), '2027-01-08');
  for (const [date, days] of [['2027-02-29', 0], ['0001-01-01', -1], ['9999-12-31', 1], ['2027-01-01', 3651]]) {
    assert.throws(() => relativeDueDate(date, days), { status: 400 });
  }
});

test('template validation, revision checks and archival preserve existing task snapshots', () => {
  const { db, store, tasks } = fixture();
  try {
    for (const input of [null, {}, { ...definition, relative_days: '-30' }, { ...definition, relative_days: 1.5 },
      { ...definition, important: 1 }, { ...definition, event_type: 'toString' }, { ...definition, actor_id: 1 }]) {
      assert.throws(() => store.createTemplate(input, 1), { status: 400 });
    }
    assert.throws(() => store.createTemplate(definition, 2), { status: 403 });
    const template = store.createTemplate({ ...definition, title: 'Private template marker' }, 1);
    const preview = store.preview(1);
    const result = store.apply(1, preview.base_date, preview.preview_token, 1);
    store.updateTemplate(template.id, { title: 'edited', relative_days: -10, active: false }, 1, 1);
    assert.equal(tasks.getTask(1, result.task_ids[0]).title, 'Private template marker');
    assert.equal(tasks.getTask(1, result.task_ids[0]).due_date, '2026-12-02');
    assert.throws(() => store.updateTemplate(template.id, { title: 'stale' }, 1, 1), { status: 409 });
    assert.throws(() => store.updateTemplate(template.id, { event_type: 'LECTURE' }, 2, 1), { status: 400 });
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM task_template_history').all()).includes('Private'));
    assert.equal(store.preview(1).items.length, 0);
    createTemplateStore(db);
    assert.equal(store.listTemplates('SEMINAR').length, 1);
    assert.throws(() => parseTemplateInput({}, true), { status: 400 });
  } finally { db.close(); }
});

test('generation is scoped to event type, requires an explicit base for multi-day events and skips inactive templates', () => {
  const { db, store } = fixture();
  try {
    store.createTemplate(definition, 1);
    store.createTemplate({ ...definition, event_type: 'LECTURE', relative_days: 7 }, 1);
    store.createTemplate({ ...definition, event_type: 'BASIC_COURSE', relative_days: 0 }, 1);
    store.createTemplate({ ...definition, active: false }, 1);
    assert.equal(store.preview(1).items.length, 1);
    assert.equal(store.preview(1).items[0].due_date, '2026-12-02');
    assert.equal(store.preview(2).items[0].due_date, '2027-02-08');
    assert.throws(() => store.preview(3), { status: 400 });
    assert.equal(store.preview(3, '2027-04-01').items[0].due_date, '2027-04-01');
    assert.throws(() => store.preview(3, '2027-05-01'), { status: 400 });
    assert.throws(() => store.preview(999), { status: 404 });
  } finally { db.close(); }
});

test('retries and fresh previews never duplicate applied templates, including deleted generated tasks', () => {
  const { db, store, tasks } = fixture();
  try {
    const template = store.createTemplate(definition, 1);
    const preview = store.preview(1);
    const first = store.apply(1, preview.base_date, preview.preview_token, 1);
    const retry = store.apply(1, preview.base_date, preview.preview_token, 1);
    assert.deepEqual(retry.task_ids, first.task_ids);
    assert.equal(retry.replayed, true);
    assert.equal(tasks.listTasks(1).length, 1);
    tasks.deleteTask(1, first.task_ids[0], 1, 1);
    assert.equal(db.prepare('SELECT task_id FROM task_template_applications').get().task_id, null);
    assert.equal(store.preview(1).items.length, 0);
    assert.equal(store.preview(1).skipped_count, 1);
    store.updateTemplate(template.id, { relative_days: -7 }, template.version, 1);
    assert.equal(store.preview(1).items.length, 0);
    store.createTemplate({ ...definition, title: 'additional' }, 1);
    const additional = store.preview(1);
    assert.equal(additional.items.length, 1);
    store.apply(1, additional.base_date, additional.preview_token, 1);
    assert.equal(tasks.listTasks(1).length, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM task_template_applications').get().n, 2);
    assert.throws(() => store.apply(1, '2027-02-01', preview.preview_token, 1), { status: 409 });
  } finally { db.close(); }
});

test('preview approval fails if templates or event dates/types changed; failures do not create partial tasks', () => {
  const { db, store, tasks } = fixture();
  try {
    const template = store.createTemplate(definition, 1);
    const first = store.preview(1);
    store.updateTemplate(template.id, { important: true }, 1, 1);
    assert.throws(() => store.apply(1, first.base_date, first.preview_token, 1), { status: 409 });
    const second = store.preview(1);
    db.prepare('UPDATE seminars SET dates=? WHERE id=1').run('["2027-02-01"]');
    assert.throws(() => store.apply(1, undefined, second.preview_token, 1), { status: 409 });
    const third = store.preview(1);
    db.prepare("UPDATE seminars SET event_type='LECTURE' WHERE id=1").run();
    assert.throws(() => store.apply(1, undefined, third.preview_token, 1), { status: 409 });
    assert.equal(tasks.listTasks(1).length, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM task_template_applications').get().n, 0);
  } finally { db.close(); }
});

test('new event and template tasks commit together; failures and explicit opt-out preserve consistency', () => {
  const { db, store, tasks } = fixture();
  try {
    store.createTemplate(definition, 1);
    const insert = (dates) => () => {
      const result = db.prepare("INSERT INTO seminars(event_type,dates) VALUES('SEMINAR',?)").run(JSON.stringify(dates));
      return { id: Number(result.lastInsertRowid) };
    };
    const event = store.createEvent(insert(['2027-06-01']), 1);
    assert.equal(tasks.listTasks(event.id)[0].due_date, '2027-05-02');
    const before = db.prepare('SELECT count(*) n FROM seminars').get().n;
    assert.throws(() => store.createEvent(insert(['2027-06-01','2027-07-01']), 1), { status: 400 });
    assert.equal(db.prepare('SELECT count(*) n FROM seminars').get().n, before);
    const draft = store.createEvent(insert([]), 1, false);
    assert.deepEqual(tasks.listTasks(draft.id), []);
    const multi = store.createEvent(insert(['2027-06-01','2027-07-01']), 1, true, '2027-07-01');
    assert.equal(tasks.listTasks(multi.id)[0].due_date, '2027-06-01');
    db.exec("CREATE TRIGGER reject_generation BEFORE INSERT ON task_history BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
    const count = db.prepare('SELECT count(*) n FROM seminars').get().n;
    assert.throws(() => store.createEvent(insert(['2027-06-01']), 1), /audit unavailable/);
    assert.equal(db.prepare('SELECT count(*) n FROM seminars').get().n, count);
  } finally { db.close(); }
});

test('a failed batch rolls back earlier generated tasks, application links and audit records', () => {
  const { db, store, tasks } = fixture();
  try {
    store.createTemplate({ ...definition, title: 'first' }, 1);
    store.createTemplate({ ...definition, title: 'fail' }, 1);
    db.exec("CREATE TRIGGER reject_second BEFORE INSERT ON event_tasks WHEN NEW.title='fail' BEGIN SELECT RAISE(ABORT,'failed task'); END;");
    const preview = store.preview(1);
    assert.throws(() => store.apply(1, preview.base_date, preview.preview_token, 1), /failed task/);
    assert.deepEqual(tasks.listTasks(1), []);
    assert.equal(db.prepare('SELECT count(*) n FROM task_history').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM task_template_applications').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM task_generation_batches').get().n, 0);
  } finally { db.close(); }
});
