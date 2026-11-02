import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { createTemplateStore } from './task-templates.ts';
import { createTaskStore } from './tasks.ts';
import { TaskError } from '../types/task.ts';
import { relativeDueDate } from '../types/task-template.ts';
import { parseScheduleInput } from '../types/reschedule.ts';
import type { ScheduleInput, ScheduleHistory, SchedulePreview } from '../types/reschedule.ts';
import { validateOccurrences } from '../types/event-schedule.ts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function createRescheduleStore(db: Database.Database) {
  createTemplateStore(db);
  const tasks = createTaskStore(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_schedule_state (
      seminar_id INTEGER PRIMARY KEY REFERENCES seminars(id) ON DELETE CASCADE, revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS event_schedule_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, seminar_id INTEGER NOT NULL, actor_id INTEGER NOT NULL,
      preview_token TEXT NOT NULL, request_hash TEXT NOT NULL,
      old_dates_json TEXT NOT NULL, new_dates_json TEXT NOT NULL, base_date TEXT,
      decisions_json TEXT NOT NULL, updated_task_ids_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(seminar_id,preview_token)
    );
  `);
  function event(id: number) {
    const row = db.prepare('SELECT * FROM seminars WHERE id=?').get(id) as { id: number; event_type: string; dates: string; occurrence_type?: string | null } | undefined;
    if (!row) throw new TaskError('イベントが見つかりません', 404);
    return { id: row.id, event_type: row.event_type, dates: row.dates,
      ...('occurrence_type' in row ? { occurrence_type: row.occurrence_type } : {}) };
  }
  function build(seminarId: number, input: ScheduleInput): SchedulePreview {
    const current = event(seminarId);
    if ('occurrence_type' in current) validateOccurrences(current.occurrence_type, input.dates);
    db.prepare('INSERT OR IGNORE INTO event_schedule_state(seminar_id) VALUES(?)').run(seminarId);
    const revision = db.prepare('SELECT revision FROM event_schedule_state WHERE seminar_id=?').get(seminarId);
    const allTasks = tasks.listTasks(seminarId).sort((a, b) => a.id - b.id);
    const applications = db.prepare(`SELECT task_id,template_id,template_version,base_date,relative_days
      FROM task_template_applications WHERE seminar_id=? AND task_id IS NOT NULL ORDER BY task_id`).all(seminarId) as {
        task_id: number; template_id: number; template_version: number; base_date: string; relative_days: number;
      }[];
    const items = allTasks.map((task) => {
      const source = applications.find((application) => application.task_id === task.id);
      return { task_id: task.id, version: task.version, title: task.title, status: task.status, important: task.important,
        current_due_date: task.due_date, proposed_due_date: source && input.base_date ? relativeDueDate(input.base_date, source.relative_days) : null,
        source: source ? 'template' as const : 'manual' as const, source_base_date: source?.base_date ?? null, relative_days: source?.relative_days ?? null,
        manually_changed: !!source && task.due_date !== relativeDueDate(source.base_date, source.relative_days) };
    });
    return { old_dates: JSON.parse(current.dates), new_dates: input.dates, base_date: input.base_date, items,
      preview_token: hash({ current, revision, tasks: allTasks, applications, dates: input.dates, base: input.base_date }) };
  }
  function decode(row: Record<string, unknown>): ScheduleHistory {
    return { id: row.id as number, actor_id: row.actor_id as number, old_dates: JSON.parse(row.old_dates_json as string),
      new_dates: JSON.parse(row.new_dates_json as string), base_date: row.base_date as string | null,
      decisions: JSON.parse(row.decisions_json as string), updated_task_ids: JSON.parse(row.updated_task_ids_json as string), occurred_at: row.occurred_at as string };
  }
  return {
    preview(seminarId: number, body: unknown) {
      const input = parseScheduleInput(body);
      return db.transaction(() => build(seminarId, input)).immediate();
    },
    apply(seminarId: number, body: unknown, actorId: number, updateDates: (dates: string[]) => unknown) {
      const input = parseScheduleInput(body, true);
      return db.transaction(() => {
        if (!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId)) throw new TaskError('ログインが必要です', 403);
        event(seminarId);
        const requestHash = hash({ dates: input.dates, base_date: input.base_date, decisions: input.decisions });
        const previous = db.prepare('SELECT * FROM event_schedule_history WHERE seminar_id=? AND preview_token=?').get(seminarId, input.preview_token) as Record<string, unknown> | undefined;
        if (previous) {
          if (previous.request_hash !== requestHash) throw new TaskError('前回と選択内容が異なります。新しくプレビューしてください', 409);
          return { history: decode(previous), replayed: true };
        }
        const preview = build(seminarId, input);
        if (input.preview_token !== preview.preview_token) throw new TaskError('日程またはタスクが変更されました。プレビューを取り直してください', 409);
        if (input.decisions.length !== preview.items.length || input.decisions.some((decision) => !preview.items.some((item) => item.task_id === decision.task_id))) {
          throw new TaskError('全タスクについて期限の扱いを選択してください');
        }
        for (const decision of input.decisions) {
          const item = preview.items.find((item) => item.task_id === decision.task_id)!;
          if (decision.action === 'proposed' && item.proposed_due_date === null) throw new TaskError('逆算できないタスクは、期限の保持または個別指定を選択してください');
        }
        updateDates(input.dates);
        // The callback must persist the intended dates on the same connection/transaction.
        if (event(seminarId).dates !== JSON.stringify(input.dates)) throw new Error('Schedule update was not persisted');
        const updatedIds: number[] = [];
        for (const decision of input.decisions) {
          if (decision.action === 'keep') continue;
          const item = preview.items.find((item) => item.task_id === decision.task_id)!;
          const dueDate = decision.action === 'custom' ? decision.due_date : item.proposed_due_date;
          if (dueDate !== item.current_due_date) {
            tasks.updateTask(seminarId, item.task_id, { due_date: dueDate }, item.version, actorId);
            updatedIds.push(item.task_id);
          }
          if (decision.action === 'proposed') {
            db.prepare('UPDATE task_template_applications SET base_date=? WHERE seminar_id=? AND task_id=?').run(input.base_date, seminarId, item.task_id);
          }
        }
        db.prepare('UPDATE event_schedule_state SET revision=revision+1 WHERE seminar_id=?').run(seminarId);
        const result = db.prepare(`INSERT INTO event_schedule_history(seminar_id,actor_id,preview_token,request_hash,old_dates_json,new_dates_json,base_date,decisions_json,updated_task_ids_json)
          VALUES(?,?,?,?,?,?,?,?,?)`).run(seminarId, actorId, input.preview_token, requestHash, JSON.stringify(preview.old_dates),
            JSON.stringify(input.dates), input.base_date, JSON.stringify(input.decisions), JSON.stringify(updatedIds));
        const row = db.prepare('SELECT * FROM event_schedule_history WHERE id=?').get(result.lastInsertRowid) as Record<string, unknown>;
        return { history: decode(row), replayed: false };
      }).immediate();
    },
    history(seminarId: number) {
      event(seminarId);
      return (db.prepare('SELECT * FROM event_schedule_history WHERE seminar_id=? ORDER BY id DESC LIMIT 50').all(seminarId) as Record<string, unknown>[]).map(decode);
    },
  };
}
