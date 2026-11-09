import type Database from 'better-sqlite3';
import { createTaskStore } from './tasks.ts';
import { EVENT_ROLES, EVENT_DAY_ROLES } from '../types/event-roles.ts';
import type { EventRoleKey } from '../types/event-roles.ts';
import { TaskError } from '../types/task.ts';
import type { TaskRoleLink } from '../types/member-page.ts';

// Role links describe responsibility, not login privileges or account assignments.
export function createTaskRoleLinkStore(db: Database.Database) {
  const tasks = createTaskStore(db);
  db.exec(`CREATE TABLE IF NOT EXISTS task_role_links (
    task_id INTEGER PRIMARY KEY REFERENCES event_tasks(id) ON DELETE CASCADE,
    role TEXT, date TEXT, version INTEGER NOT NULL DEFAULT 1,
    CHECK(role IS NOT NULL OR date IS NULL));
    CREATE TABLE IF NOT EXISTS task_role_link_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, task_id INTEGER NOT NULL, seminar_id INTEGER NOT NULL,
      actor_id INTEGER NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);
  function read(eventId: number, taskId: number): TaskRoleLink {
    tasks.getTask(eventId, taskId);
    return db.prepare('SELECT task_id,role,date,version FROM task_role_links WHERE task_id=?').get(taskId) as TaskRoleLink | undefined
      ?? { task_id: taskId, role: null, date: null, version: 0 };
  }
  return {
    read,
    list(eventId: number): TaskRoleLink[] {
      return db.prepare(`SELECT l.task_id,l.role,l.date,l.version FROM task_role_links l
        JOIN event_tasks t ON t.id=l.task_id WHERE t.seminar_id=?`).all(eventId) as TaskRoleLink[];
    },
    save(eventId: number, taskId: number, value: unknown, actorId: number) {
      return db.transaction(() => {
        if (!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId)) throw new TaskError('ログインが必要です', 403);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('役割連動の入力形式が不正です');
        const p = value as Record<string, unknown>;
        if (Object.keys(p).some(k => !['role', 'date', 'version'].includes(k)) || typeof p.version !== 'number' || !Number.isSafeInteger(p.version) || p.version < 0) throw new TaskError('役割連動の入力形式が不正です');
        const current = read(eventId, taskId);
        if (p.version !== current.version) throw new TaskError('役割連動が更新されています。最新情報を取得してください', 409);
        if (p.role !== null && (typeof p.role !== 'string' || !Object.hasOwn(EVENT_ROLES, p.role))) throw new TaskError('連動する役割を選択してください');
        if (p.date !== null && typeof p.date !== 'string') throw new TaskError('対象の開催日が不正です');
        if ((p.role === null || !Object.hasOwn(EVENT_DAY_ROLES, p.role as string)) && p.date !== null) throw new TaskError('準備役割はイベント全体に設定してください');
        const dates: string[] = JSON.parse((db.prepare('SELECT dates FROM seminars WHERE id=?').get(eventId) as { dates: string }).dates);
        if (p.date !== null && !(dates.length ? dates : ['']).includes(p.date as string)) throw new TaskError('現在の開催日から選択してください', 409);
        db.prepare(`INSERT INTO task_role_links(task_id,role,date) VALUES(?,?,?) ON CONFLICT(task_id)
          DO UPDATE SET role=excluded.role,date=excluded.date,version=task_role_links.version+1`).run(taskId, p.role as EventRoleKey | null, p.date as string | null);
        const after = read(eventId, taskId);
        db.prepare('INSERT INTO task_role_link_history(task_id,seminar_id,actor_id,before_json,after_json) VALUES(?,?,?,?,?)')
          .run(taskId, eventId, actorId, JSON.stringify(current), JSON.stringify(after));
        return after;
      }).immediate();
    },
  };
}
