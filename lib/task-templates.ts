import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createTaskStore } from './tasks.ts';
import { parseVersion, TaskError } from '../types/task.ts';
import type { EventType } from '../types/seminar.ts';
import { parseTemplateInput, relativeDueDate, requireDate } from '../types/task-template.ts';
import type { GenerationPreview, TaskTemplate, TemplateInput } from '../types/task-template.ts';

type TemplateRow = Omit<TaskTemplate, 'important' | 'active'> & { important: number; active: number };
type BatchResult = { task_ids: number[]; created_count: number; replayed: boolean };

export function createTemplateStore(db: Database.Database) {
  const tasks = createTaskStore(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL CHECK(event_type IN ('BASIC_COURSE','LECTURE','SEMINAR')),
      title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200), description TEXT NOT NULL DEFAULT '',
      relative_days INTEGER NOT NULL CHECK(relative_days BETWEEN -3650 AND 3650),
      important INTEGER NOT NULL DEFAULT 0 CHECK(important IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS task_templates_type ON task_templates(event_type,active);
    CREATE TABLE IF NOT EXISTS task_template_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, template_id INTEGER NOT NULL, actor_id INTEGER NOT NULL,
      action TEXT NOT NULL, before_json TEXT, after_json TEXT, fields_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS task_template_applications (
      seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
      template_id INTEGER NOT NULL REFERENCES task_templates(id),
      template_version INTEGER NOT NULL, base_date TEXT NOT NULL, relative_days INTEGER NOT NULL,
      task_id INTEGER REFERENCES event_tasks(id) ON DELETE SET NULL,
      PRIMARY KEY(seminar_id,template_id)
    );
    CREATE TABLE IF NOT EXISTS task_generation_batches (
      seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
      preview_token TEXT NOT NULL, base_date TEXT, task_ids_json TEXT NOT NULL,
      PRIMARY KEY(seminar_id,preview_token)
    );
  `);
  const fromRow = (row: TemplateRow): TaskTemplate => ({ ...row, important: Boolean(row.important), active: Boolean(row.active) });
  function actor(id: number) {
    if (!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(id)) throw new TaskError('ログインが必要です', 403);
  }
  function getTemplate(id: number) {
    const row = db.prepare('SELECT * FROM task_templates WHERE id=?').get(id) as TemplateRow | undefined;
    if (!row) throw new TaskError('テンプレートが見つかりません', 404);
    return fromRow(row);
  }
  function listTemplates(type?: EventType) {
    const rows = type ? db.prepare('SELECT * FROM task_templates WHERE event_type=? ORDER BY id').all(type)
      : db.prepare('SELECT * FROM task_templates ORDER BY id').all();
    return (rows as TemplateRow[]).map(fromRow);
  }
  function log(before: TaskTemplate | null, after: TaskTemplate, actorId: number, fields: string[]) {
    const safe = (template: TaskTemplate) => ({ event_type: template.event_type, relative_days: template.relative_days,
      important: template.important, active: template.active, version: template.version });
    db.prepare(`INSERT INTO task_template_history(template_id,actor_id,action,before_json,after_json,fields_json)
      VALUES(?,?,?,?,?,?)`).run(after.id, actorId, before ? 'updated' : 'created', before ? JSON.stringify(safe(before)) : null,
      JSON.stringify(safe(after)), JSON.stringify(fields));
  }
  function seminar(id: number) {
    const row = db.prepare('SELECT id,event_type,dates FROM seminars WHERE id=?').get(id) as { id: number; event_type: EventType; dates: string } | undefined;
    if (!row) throw new TaskError('イベントが見つかりません', 404);
    return row;
  }
  function buildPreview(seminarId: number, baseDate?: string): GenerationPreview {
    const event = seminar(seminarId);
    const active = listTemplates(event.event_type).filter((template) => template.active);
    const rawDates: unknown = JSON.parse(event.dates);
    if (!Array.isArray(rawDates)) throw new TaskError('イベントの開催日を確認してください');
    const dates = [...new Set(rawDates.map(requireDate))];
    let base: string | null = baseDate === undefined ? (dates.length === 1 ? dates[0] : null) : requireDate(baseDate);
    if (base && !dates.includes(base)) throw new TaskError('基準日はイベントの開催日から選択してください');
    if (active.length && !base) throw new TaskError('期限の基準となる開催日を1つ選択してください。日程未定の場合は自動生成を外して登録できます');
    if (!active.length && !base) base = null;
    const applied = db.prepare('SELECT template_id FROM task_template_applications WHERE seminar_id=? ORDER BY template_id').all(seminarId) as { template_id: number }[];
    const ids = new Set(applied.map((row) => row.template_id));
    const items = active.filter((template) => !ids.has(template.id)).map((template) => ({
      id: template.id, version: template.version, title: template.title, description: template.description,
      relative_days: template.relative_days, important: template.important, due_date: relativeDueDate(base!, template.relative_days),
    }));
    const token = createHash('sha256').update(JSON.stringify({ seminarId, event_type: event.event_type, dates, base,
      templates: active.map((template) => [template.id, template.version]), applied: [...ids] })).digest('hex');
    return { base_date: base, event_type: event.event_type, items, skipped_count: active.length - items.length, preview_token: token };
  }
  function apply(seminarId: number, baseDate: string | undefined, token: string, actorId: number): BatchResult {
    actor(actorId); seminar(seminarId);
    const previous = db.prepare('SELECT base_date,task_ids_json FROM task_generation_batches WHERE seminar_id=? AND preview_token=?').get(seminarId, token) as { base_date: string | null; task_ids_json: string } | undefined;
    if (previous) {
      if (baseDate !== undefined && baseDate !== previous.base_date) throw new TaskError('基準日が前回の操作と異なります。プレビューを取り直してください', 409);
      const ids = JSON.parse(previous.task_ids_json) as number[];
      return { task_ids: ids, created_count: ids.length, replayed: true };
    }
    const preview = buildPreview(seminarId, baseDate);
    if (preview.preview_token !== token) throw new TaskError('開催日またはテンプレートが変更されました。プレビューを取り直してください', 409);
    const ids: number[] = [];
    for (const item of preview.items) {
      const task = tasks.createTask(seminarId, { title: item.title, description: item.description, due_date: item.due_date, important: item.important }, actorId);
      db.prepare(`INSERT INTO task_template_applications(seminar_id,template_id,template_version,base_date,relative_days,task_id)
        VALUES(?,?,?,?,?,?)`).run(seminarId, item.id, item.version, preview.base_date, item.relative_days, task.id);
      ids.push(task.id);
    }
    db.prepare('INSERT INTO task_generation_batches(seminar_id,preview_token,base_date,task_ids_json) VALUES(?,?,?,?)').run(seminarId, token, preview.base_date, JSON.stringify(ids));
    return { task_ids: ids, created_count: ids.length, replayed: false };
  }
  return {
    getTemplate, listTemplates,
    createTemplate(body: unknown, actorId: number) {
      const input: TemplateInput = { event_type: 'SEMINAR', title: '', description: '', relative_days: 0, important: false, active: true, ...parseTemplateInput(body) };
      return db.transaction(() => {
        actor(actorId);
        const row = db.prepare('INSERT INTO task_templates(event_type,title,description,relative_days,important,active) VALUES(?,?,?,?,?,?)')
          .run(input.event_type, input.title, input.description, input.relative_days, input.important ? 1 : 0, input.active ? 1 : 0);
        const template = getTemplate(Number(row.lastInsertRowid)); log(null, template, actorId, Object.keys(input)); return template;
      }).immediate();
    },
    updateTemplate(id: number, body: unknown, version: number, actorId: number) {
      const input = parseTemplateInput(body, true); parseVersion(version);
      return db.transaction(() => {
        actor(actorId); const before = getTemplate(id);
        if (before.version !== version) throw new TaskError('別のメンバーが更新しました。最新の内容を取得してください', 409);
        const merged = { ...before, ...input };
        db.prepare('UPDATE task_templates SET title=?,description=?,relative_days=?,important=?,active=?,version=version+1 WHERE id=?')
          .run(merged.title, merged.description, merged.relative_days, merged.important ? 1 : 0, merged.active ? 1 : 0, id);
        const after = getTemplate(id); log(before, after, actorId, Object.keys(input)); return after;
      }).immediate();
    },
    preview(seminarId: number, baseDate?: string) { return db.transaction(() => buildPreview(seminarId, baseDate))(); },
    apply(seminarId: number, baseDate: string | undefined, token: string, actorId: number) {
      if (!/^[a-f0-9]{64}$/.test(token)) throw new TaskError('プレビューを先に確認してください');
      return db.transaction(() => apply(seminarId, baseDate, token, actorId)).immediate();
    },
    createEvent<T extends { id: number }>(create: () => T, actorId: number, generate = true, baseDate?: string) {
      return db.transaction(() => {
        actor(actorId); const event = create();
        if (generate) {
          const preview = buildPreview(event.id, baseDate);
          if (preview.items.length) apply(event.id, baseDate, preview.preview_token, actorId);
        }
        return event;
      }).immediate();
    },
  };
}
