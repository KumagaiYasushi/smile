import type Database from 'better-sqlite3';
import { EVENT_TYPES, TASK_PHASES, TASK_STATUSES } from '../types/event.ts';
import type { EventDetail, EventRecord, EventSession, EventTask, Member, TaskTemplate, SchedulePreview } from '../types/event.ts';

export class EventError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
type Input = Record<string, unknown>;
function object(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EventError('入力内容を確認してください');
  return value as Input;
}
function fields(input: Input, allowed: string[]) {
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new EventError('未対応の項目が含まれています。日程の変更はプレビューのみ利用できます。');
}
function text(value: unknown, required = false, max = 2000) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) throw new EventError('文字項目の入力を確認してください');
  return value.trim();
}
function integer(value: unknown, min = 0, max = 100000000) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new EventError('数値項目の入力を確認してください');
  return value;
}
function flag(value: unknown) {
  if (typeof value !== 'boolean') throw new EventError('チェック項目の入力を確認してください');
  return value;
}
function choice<T extends string>(value: unknown, choices: Record<T, unknown>): T {
  if (typeof value !== 'string' || !Object.hasOwn(choices, value)) throw new EventError('選択項目の入力を確認してください');
  return value as T;
}
export function dateOnly(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
    throw new EventError('正しい日付を入力してください');
  }
  return value;
}
function instant(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?)?(Z|\+09:00)$/.test(value) || !Number.isFinite(Date.parse(value))) throw new EventError('日時は日本時間またはUTCで入力してください');
  dateOnly(value.slice(0, 10));
  if (Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || (value[16] === ':' && Number(value.slice(17, 19)) > 59)) throw new EventError('時刻の入力を確認してください');
  return new Date(value).toISOString();
}
export function jstDate(iso: string) { return new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10); }
export function relativeDate(iso: string, days: number) {
  return new Date(Date.parse(jstDate(iso)) + days * 86400000).toISOString().slice(0, 10);
}
function sessionsInput(value: unknown): EventSession[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 50) throw new EventError('開催回は1〜50回で入力してください');
  const sessions = value.map(raw => {
    const item = object(raw); fields(item, ['starts_at', 'ends_at']);
    const starts_at = instant(item.starts_at), ends_at = instant(item.ends_at);
    if (starts_at >= ends_at) throw new EventError('終了日時は開始日時より後にしてください');
    return { starts_at, ends_at };
  }).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (sessions.some((session, index) => index > 0 && session.starts_at < sessions[index - 1].ends_at)) throw new EventError('開催回の時間が重なっています');
  return sessions;
}

export class EventStore {
  private db: Database.Database;
  constructor(db: Database.Database) {
    this.db = db;
    db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('BASIC_COURSE','LECTURE','SEMINAR')),
        title TEXT NOT NULL, overview TEXT NOT NULL, venue TEXT NOT NULL, lecturer TEXT NOT NULL,
        owner_id INTEGER NOT NULL REFERENCES users(id), capacity INTEGER, fee INTEGER, application_deadline TEXT,
        starts_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS event_sessions (
        id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        session_no INTEGER NOT NULL, starts_at TEXT NOT NULL, ends_at TEXT NOT NULL, UNIQUE(event_id,session_no)
      );
      CREATE TABLE IF NOT EXISTS task_templates (
        id INTEGER PRIMARY KEY, family TEXT NOT NULL CHECK(family IN ('BASIC_COURSE','LECTURE_SEMINAR')),
        title TEXT NOT NULL, relative_days INTEGER NOT NULL, phase TEXT NOT NULL,
        important INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        template_id INTEGER REFERENCES task_templates(id), title TEXT NOT NULL, relative_days INTEGER,
        due_on TEXT NOT NULL, due_mode TEXT NOT NULL CHECK(due_mode IN ('RELATIVE','MANUAL')),
        phase TEXT NOT NULL, important INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'TODO'
        CHECK(status IN ('TODO','IN_PROGRESS','REVIEW','DONE')), assignee_id INTEGER REFERENCES users(id), version INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS task_collaborators (
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, user_id INTEGER NOT NULL REFERENCES users(id),
        PRIMARY KEY(task_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS event_audit_logs (
        id INTEGER PRIMARY KEY, event_id INTEGER REFERENCES events(id), actor_id INTEGER NOT NULL REFERENCES users(id),
        target_type TEXT NOT NULL, target_id INTEGER NOT NULL, action TEXT NOT NULL,
        before_json TEXT, after_json TEXT, occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS tasks_event_id ON tasks(event_id);
    `);
  }
  members() { return this.db.prepare('SELECT id,name FROM users WHERE active=1 ORDER BY id').all() as Member[]; }
  private member(value: unknown, nullable = false) {
    if (nullable && value === null) return null;
    const id = integer(value, 1);
    if (!this.db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(id)) throw new EventError('有効な担当者を選択してください');
    return id;
  }
  private audit(actor: number, event: number | null, type: string, id: number, action: string, before: unknown, after: unknown) {
    this.db.prepare('INSERT INTO event_audit_logs(actor_id,event_id,target_type,target_id,action,before_json,after_json) VALUES (?,?,?,?,?,?,?)')
      .run(actor, event, type, id, action, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after));
  }
  templates() {
    return (this.db.prepare('SELECT * FROM task_templates ORDER BY family,relative_days,id').all() as TaskTemplate[])
      .map(row => ({ ...row, important: Boolean(row.important), active: Boolean(row.active) }));
  }
  saveTemplate(raw: unknown, actor: number, id?: number) {
    const input = object(raw); fields(input, ['family', 'title', 'relative_days', 'phase', 'important', 'active', 'version']);
    const family = choice(input.family, { BASIC_COURSE: '', LECTURE_SEMINAR: '' });
    const title = text(input.title, true, 200), days = integer(input.relative_days, -3650, 3650);
    const phase = choice(input.phase, TASK_PHASES), important = flag(input.important), active = flag(input.active);
    return this.db.transaction(() => {
      this.member(actor);
      const before = id ? this.templates().find(row => row.id === id) : null;
      if (id && !before) throw new EventError('テンプレートが見つかりません', 404);
      if (before) {
        if (integer(input.version, 1) !== before.version) throw new EventError('他の人が更新しました。再読み込みしてください', 409);
        this.db.prepare('UPDATE task_templates SET family=?,title=?,relative_days=?,phase=?,important=?,active=?,version=version+1 WHERE id=?')
          .run(family, title, days, phase, Number(important), Number(active), id);
      } else {
        id = Number(this.db.prepare('INSERT INTO task_templates(family,title,relative_days,phase,important,active) VALUES (?,?,?,?,?,?)')
          .run(family, title, days, phase, Number(important), Number(active)).lastInsertRowid);
      }
      this.audit(actor, null, 'template', id!, before ? 'updated' : 'created', before ? { version: before.version } : null, { family, days, important, active });
      return this.templates().find(row => row.id === id)!;
    })();
  }
  list() { return this.db.prepare('SELECT * FROM events ORDER BY starts_at,id').all() as EventRecord[]; }
  get(id: number): EventDetail {
    const event = this.db.prepare('SELECT * FROM events WHERE id=?').get(id) as EventRecord | undefined;
    if (!event) throw new EventError('イベントが見つかりません', 404);
    const sessions = this.db.prepare('SELECT starts_at,ends_at FROM event_sessions WHERE event_id=? ORDER BY session_no').all(id) as EventSession[];
    const tasks = (this.db.prepare('SELECT * FROM tasks WHERE event_id=? ORDER BY due_on,id').all(id) as EventTask[]).map(row => ({
      ...row, important: Boolean(row.important), collaborator_ids: (this.db.prepare('SELECT user_id FROM task_collaborators WHERE task_id=? ORDER BY user_id').all(row.id) as { user_id: number }[]).map(item => item.user_id),
    }));
    return { ...event, sessions, tasks };
  }
  create(raw: unknown, actor: number) {
    const input = object(raw); fields(input, ['type', 'title', 'overview', 'venue', 'lecturer', 'owner_id', 'capacity', 'fee', 'application_deadline', 'sessions']);
    const type = choice(input.type, EVENT_TYPES), title = text(input.title, true, 200);
    const overview = text(input.overview), venue = text(input.venue), lecturer = text(input.lecturer);
    const sessions = sessionsInput(input.sessions);
    const capacity = input.capacity === null || input.capacity === undefined ? null : integer(input.capacity, 1, 100000);
    const fee = input.fee === null || input.fee === undefined ? null : integer(input.fee);
    const deadline = input.application_deadline === null || input.application_deadline === undefined ? null : instant(input.application_deadline);
    if (deadline && deadline > sessions[0].starts_at) throw new EventError('申込締切は初回開催以前にしてください');
    return this.db.transaction(() => {
      const owner = this.member(input.owner_id); this.member(actor);
      const id = Number(this.db.prepare('INSERT INTO events(type,title,overview,venue,lecturer,owner_id,capacity,fee,application_deadline,starts_at) VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(type, title, overview, venue, lecturer, owner, capacity, fee, deadline, sessions[0].starts_at).lastInsertRowid);
      sessions.forEach((session, index) => this.db.prepare('INSERT INTO event_sessions(event_id,session_no,starts_at,ends_at) VALUES (?,?,?,?)').run(id, index + 1, session.starts_at, session.ends_at));
      const templates = this.templates().filter(row => row.active && row.family === (type === 'BASIC_COURSE' ? 'BASIC_COURSE' : 'LECTURE_SEMINAR'));
      if (templates.length === 0) throw new EventError('先にこの種別の標準タスクテンプレートを登録してください');
      for (const template of templates) {
        this.db.prepare("INSERT INTO tasks(event_id,template_id,title,relative_days,due_on,due_mode,phase,important) VALUES (?,?,?,?,?,'RELATIVE',?,?)")
          .run(id, template.id, template.title, template.relative_days, relativeDate(sessions[0].starts_at, template.relative_days), template.phase, Number(template.important));
      }
      this.audit(actor, id, 'event', id, 'created', null, { type, starts_at: sessions[0].starts_at, task_count: templates.length, owner_id: owner });
      return this.get(id);
    })();
  }
  updateOwner(id: number, raw: unknown, actor: number) {
    const input = object(raw); fields(input, ['owner_id', 'version']);
    return this.db.transaction(() => {
      const event = this.get(id), owner = this.member(input.owner_id); this.member(actor);
      if (integer(input.version, 1) !== event.version) throw new EventError('他の人が更新しました。再読み込みしてください', 409);
      this.db.prepare('UPDATE events SET owner_id=?,version=version+1 WHERE id=?').run(owner, id);
      this.audit(actor, id, 'event', id, 'owner_updated', { owner_id: event.owner_id }, { owner_id: owner });
      return this.get(id);
    })();
  }
  addTask(id: number, raw: unknown, actor: number) {
    const input = object(raw); fields(input, ['title', 'due_on', 'phase', 'important']);
    const title = text(input.title, true, 200), due = dateOnly(input.due_on), phase = choice(input.phase, TASK_PHASES), important = flag(input.important);
    return this.db.transaction(() => {
      this.get(id); this.member(actor);
      const taskId = Number(this.db.prepare("INSERT INTO tasks(event_id,title,due_on,due_mode,phase,important) VALUES (?,?,?,'MANUAL',?,?)").run(id, title, due, phase, Number(important)).lastInsertRowid);
      this.audit(actor, id, 'task', taskId, 'created', null, { due_on: due, phase, important });
      return this.get(id).tasks.find(task => task.id === taskId)!;
    })();
  }
  updateTask(id: number, raw: unknown, actor: number) {
    const input = object(raw); fields(input, ['version', 'status', 'assignee_id', 'collaborator_ids', 'important', 'due_on']);
    return this.db.transaction(() => {
      this.member(actor);
      const row = this.db.prepare('SELECT event_id FROM tasks WHERE id=?').get(id) as { event_id: number } | undefined;
      if (!row) throw new EventError('タスクが見つかりません', 404);
      const before = this.get(row.event_id).tasks.find(task => task.id === id)!;
      if (integer(input.version, 1) !== before.version) throw new EventError('他の人が更新しました。再読み込みしてください', 409);
      const status = input.status === undefined ? before.status : choice(input.status, TASK_STATUSES);
      const assignee = input.assignee_id === undefined ? before.assignee_id : this.member(input.assignee_id, true);
      const important = input.important === undefined ? before.important : flag(input.important);
      const due = input.due_on === undefined ? before.due_on : dateOnly(input.due_on);
      const mode = due === before.due_on ? before.due_mode : 'MANUAL';
      let collaborators = before.collaborator_ids;
      if (input.collaborator_ids !== undefined) {
        if (!Array.isArray(input.collaborator_ids) || input.collaborator_ids.length > 100) throw new EventError('協力者を確認してください');
        collaborators = [...new Set(input.collaborator_ids.map(value => this.member(value)!))];
      }
      if (assignee !== null && collaborators.includes(assignee)) throw new EventError('主担当と協力者は別の人を選んでください');
      this.db.prepare('UPDATE tasks SET status=?,assignee_id=?,important=?,due_on=?,due_mode=?,version=version+1 WHERE id=?').run(status, assignee, Number(important), due, mode, id);
      this.db.prepare('DELETE FROM task_collaborators WHERE task_id=?').run(id);
      collaborators.forEach(member => this.db.prepare('INSERT INTO task_collaborators VALUES (?,?)').run(id, member));
      const after = this.get(row.event_id).tasks.find(task => task.id === id)!;
      const safe = (task: EventTask) => ({ status: task.status, assignee_id: task.assignee_id, collaborator_ids: task.collaborator_ids, important: task.important, due_on: task.due_on, due_mode: task.due_mode });
      this.audit(actor, row.event_id, 'task', id, 'updated', safe(before), safe(after));
      return after;
    })();
  }
  preview(id: number, raw: unknown): SchedulePreview {
    const input = object(raw); fields(input, ['sessions']);
    const sessions = sessionsInput(input.sessions), event = this.get(id);
    return { can_apply: false, changes: event.tasks.map(task => ({ id: task.id, title: task.title, before: task.due_on,
      proposed: task.relative_days === null ? task.due_on : relativeDate(sessions[0].starts_at, task.relative_days),
      needs_decision: task.status === 'DONE' || task.due_mode === 'MANUAL',
    })) };
  }
  history(id: number) {
    this.get(id);
    return this.db.prepare('SELECT * FROM event_audit_logs WHERE event_id=? ORDER BY id DESC LIMIT 100').all(id) as { id: number; actor_id: number; action: string; target_type: string; target_id: number; before_json: string | null; after_json: string | null; occurred_at: string }[];
  }
}
