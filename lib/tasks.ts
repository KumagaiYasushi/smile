import type Database from 'better-sqlite3';
import { parseTaskInput, parseVersion, TaskError } from '../types/task.ts';
import type { EventTask, TaskInput, TaskAuditSnapshot, TaskHistory, TaskMember } from '../types/task.ts';

type TaskRow = Omit<EventTask, 'important' | 'collaborator_ids'> & { important: number };

export function createTaskStore(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
      title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
      description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=2000),
      due_date TEXT,
      status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK(status IN ('NOT_STARTED','IN_PROGRESS','IN_REVIEW','DONE')),
      important INTEGER NOT NULL DEFAULT 0 CHECK(important IN (0,1)),
      assignee_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS event_tasks_seminar ON event_tasks(seminar_id);
    CREATE TABLE IF NOT EXISTS task_collaborators (
      task_id INTEGER NOT NULL REFERENCES event_tasks(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      PRIMARY KEY(task_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS task_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, seminar_id INTEGER NOT NULL, task_id INTEGER NOT NULL,
      actor_id INTEGER NOT NULL, action TEXT NOT NULL CHECK(action IN ('created','updated','deleted')),
      before_json TEXT, after_json TEXT, changed_fields_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS task_history_task ON task_history(seminar_id,task_id,id);
  `);

  function requireSeminar(id: number) {
    if (!db.prepare('SELECT id FROM seminars WHERE id=?').get(id)) throw new TaskError('イベントが見つかりません', 404);
  }
  function activeUser(id: number) {
    return !!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(id);
  }
  function rowToTask(row: TaskRow): EventTask {
    const collaborators = db.prepare('SELECT user_id FROM task_collaborators WHERE task_id=? ORDER BY user_id').all(row.id) as { user_id: number }[];
    return { ...row, important: Boolean(row.important), collaborator_ids: collaborators.map((item) => item.user_id) };
  }
  function getTask(seminarId: number, id: number) {
    requireSeminar(seminarId);
    const row = db.prepare('SELECT * FROM event_tasks WHERE seminar_id=? AND id=?').get(seminarId, id) as TaskRow | undefined;
    if (!row) throw new TaskError('タスクが見つかりません', 404);
    return rowToTask(row);
  }
  function validateMembers(input: Partial<TaskInput>, actorId: number) {
    if (!activeUser(actorId)) throw new TaskError('有効な運営メンバーとしてログインしてください', 403);
    if (input.assignee_id != null && !activeUser(input.assignee_id)) throw new TaskError('有効な主担当者を選択してください');
    if (input.collaborator_ids?.some((id) => !activeUser(id))) throw new TaskError('協力者に無効なアカウントが含まれています');
  }
  function setCollaborators(id: number, ids: number[]) {
    db.prepare('DELETE FROM task_collaborators WHERE task_id=?').run(id);
    const insert = db.prepare('INSERT INTO task_collaborators(task_id,user_id) VALUES(?,?)');
    for (const userId of ids) insert.run(id, userId);
  }
  function snapshot(task: EventTask): TaskAuditSnapshot {
    return { due_date: task.due_date, status: task.status, important: task.important,
      assignee_id: task.assignee_id, collaborator_ids: task.collaborator_ids };
  }
  function record(seminarId: number, taskId: number, actorId: number, action: string, before: EventTask | null, after: EventTask | null, fields: string[]) {
    // Free text can contain personal data. Record field names, dates, states and account IDs only.
    db.prepare(`INSERT INTO task_history(seminar_id,task_id,actor_id,action,before_json,after_json,changed_fields_json)
      VALUES(?,?,?,?,?,?,?)`).run(seminarId, taskId, actorId, action, before ? JSON.stringify(snapshot(before)) : null,
      after ? JSON.stringify(snapshot(after)) : null, JSON.stringify(fields));
  }

  return {
    getTask,
    listMembers(): TaskMember[] {
      return db.prepare('SELECT id,email FROM auth_users WHERE active=1 ORDER BY id').all() as TaskMember[];
    },
    listTasks(seminarId: number) {
      requireSeminar(seminarId);
      return (db.prepare(`SELECT * FROM event_tasks WHERE seminar_id=?
        ORDER BY (status='DONE'), (due_date IS NULL), due_date, id`).all(seminarId) as TaskRow[]).map(rowToTask);
    },
    createTask(seminarId: number, body: unknown, actorId: number) {
      const parsed = parseTaskInput(body);
      const input: TaskInput = { title: '', description: '', due_date: null, status: 'NOT_STARTED', important: false,
        assignee_id: null, collaborator_ids: [], ...parsed };
      return db.transaction(() => {
        requireSeminar(seminarId);
        validateMembers(input, actorId);
        const result = db.prepare(`INSERT INTO event_tasks(seminar_id,title,description,due_date,status,important,assignee_id)
          VALUES(?,?,?,?,?,?,?)`).run(seminarId, input.title, input.description, input.due_date, input.status,
          input.important ? 1 : 0, input.assignee_id);
        const id = Number(result.lastInsertRowid);
        setCollaborators(id, input.collaborator_ids);
        const task = getTask(seminarId, id);
        record(seminarId, id, actorId, 'created', null, task, Object.keys(input));
        return task;
      }).immediate();
    },
    updateTask(seminarId: number, id: number, body: unknown, version: number, actorId: number) {
      const input = parseTaskInput(body, true);
      parseVersion(version);
      return db.transaction(() => {
        const current = getTask(seminarId, id);
        if (current.version !== version) throw new TaskError('別のメンバーが更新しました。最新の内容を読み直してください', 409);
        // Existing assignments survive deactivation; only newly selected accounts must be active.
        validateMembers({
          assignee_id: input.assignee_id === current.assignee_id ? undefined : input.assignee_id,
          collaborator_ids: input.collaborator_ids?.filter((id) => !current.collaborator_ids.includes(id)),
        }, actorId);
        const merged = { ...current, ...input };
        db.prepare(`UPDATE event_tasks SET title=?,description=?,due_date=?,status=?,important=?,assignee_id=?,
          version=version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE seminar_id=? AND id=? AND version=?`)
          .run(merged.title, merged.description, merged.due_date, merged.status, merged.important ? 1 : 0,
            merged.assignee_id, seminarId, id, version);
        if (input.collaborator_ids !== undefined) setCollaborators(id, input.collaborator_ids);
        const updated = getTask(seminarId, id);
        record(seminarId, id, actorId, 'updated', current, updated, Object.keys(input));
        return updated;
      }).immediate();
    },
    deleteTask(seminarId: number, id: number, version: number, actorId: number) {
      parseVersion(version);
      return db.transaction(() => {
        const task = getTask(seminarId, id);
        validateMembers({}, actorId);
        if (task.version !== version) throw new TaskError('別のメンバーが更新しました。最新の内容を読み直してください', 409);
        record(seminarId, id, actorId, 'deleted', task, null, []);
        db.prepare('DELETE FROM event_tasks WHERE seminar_id=? AND id=?').run(seminarId, id);
      }).immediate();
    },
    history(seminarId: number, id: number): TaskHistory[] {
      getTask(seminarId, id);
      const rows = db.prepare('SELECT * FROM task_history WHERE seminar_id=? AND task_id=? ORDER BY id DESC').all(seminarId, id) as {
        id: number; actor_id: number; action: TaskHistory['action']; before_json: string | null; after_json: string | null; changed_fields_json: string; occurred_at: string;
      }[];
      return rows.map((row) => ({ id: row.id, actor_id: row.actor_id, action: row.action,
        before: row.before_json ? JSON.parse(row.before_json) : null, after: row.after_json ? JSON.parse(row.after_json) : null,
        changed_fields: JSON.parse(row.changed_fields_json), occurred_at: row.occurred_at }));
    },
  };
}
