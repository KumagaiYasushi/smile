import type Database from 'better-sqlite3';
import { TaskError, parseVersion } from '../types/task.ts';
import { requireDate } from '../types/task-template.ts';
import { STAFF_ROLE_LABELS, STAFF_SELECTABLE_ROLE_LABELS, STAFF_RESPONSE_LABELS, attendanceDateKeys } from '../types/staff-attendance.ts';
import type { StaffPerson, StaffInput, StaffRole, StaffResponse, StaffHistory, StaffAttendance } from '../types/staff-attendance.ts';

type PersonRow = Omit<StaffPerson, 'responses'> & { responses_json: string };
type EventRow = { name: string; dates: string; lecturer_name: string; assistant_members: string; lecturer_role?: StaffRole | null; external_lecturer?: string };
const toPerson = ({ responses_json, ...row }: PersonRow): StaffPerson => ({ ...row, responses: JSON.parse(responses_json) });

export function createStaffAttendanceStore(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
      role TEXT NOT NULL CHECK(role IN ('LECTURER','SUPPORT','EXTERNAL_LECTURER','SOCIETY_LECTURER','SOCIETY_SUPPORT')),
      responses_json TEXT NOT NULL DEFAULT '{}',
      version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(seminar_id,role,name)
    );
    CREATE TABLE IF NOT EXISTS event_staff_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
      person_id INTEGER NOT NULL, actor_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('created','updated','deleted')),
      before_json TEXT, after_json TEXT,
      occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS event_staff_history_event ON event_staff_history(seminar_id,id);
  `);

  db.transaction(() => {
    const schema = db.prepare("SELECT sql FROM sqlite_master WHERE name='event_staff'").get() as { sql: string };
    if (!schema.sql.includes('SOCIETY_LECTURER')) {
      const sequence = (db.prepare("SELECT seq FROM sqlite_sequence WHERE name='event_staff'").get() as { seq: number } | undefined)?.seq ?? 0;
      db.exec(`CREATE TABLE event_staff_roles_migration (
        id INTEGER PRIMARY KEY AUTOINCREMENT, seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
        role TEXT NOT NULL CHECK(role IN ('LECTURER','SUPPORT','EXTERNAL_LECTURER','SOCIETY_LECTURER','SOCIETY_SUPPORT')),
        responses_json TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(seminar_id,role,name));
        INSERT INTO event_staff_roles_migration SELECT * FROM event_staff;
        DROP TABLE event_staff;
        ALTER TABLE event_staff_roles_migration RENAME TO event_staff;`);
      const restored = db.prepare("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='event_staff'").run(sequence);
      if (!restored.changes) db.prepare('INSERT INTO sqlite_sequence(name,seq) VALUES(?,?)').run('event_staff', sequence);
    }
  }).immediate();

  db.exec(`CREATE TABLE IF NOT EXISTS event_staff_directory_links (
    person_id INTEGER PRIMARY KEY REFERENCES event_staff(id) ON DELETE CASCADE,
    seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
    member_id INTEGER NOT NULL, UNIQUE(seminar_id,member_id));`);

  function event(id: number) {
    const row = db.prepare('SELECT * FROM seminars WHERE id=?').get(id) as EventRow | undefined;
    if (!row) throw new TaskError('イベントが見つかりません', 404);
    const dates = [...new Set((JSON.parse(row.dates) as string[]).map(date => requireDate(date)))].sort();
    return { ...row, dates };
  }
  function actor(id: number) {
    if (!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(id)) throw new TaskError('有効な運営メンバーとしてログインしてください', 403);
  }
  function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('入力形式が不正です');
    return value as Record<string, unknown>;
  }
  function schedule(value: unknown, dates: string[]) {
    if (!Array.isArray(value) || value.some(date => typeof date !== 'string')) throw new TaskError('開催日の確認情報が必要です');
    if (JSON.stringify(value) !== JSON.stringify(dates)) throw new TaskError('開催日が変更されています。最新情報を取得して出欠予定を確認してください', 409);
  }
  function input(value: unknown, dates: string[], legacyImport = false): StaffInput {
    const body = object(value);
    if (Object.keys(body).some(key => !['name', 'role', 'responses', 'schedule'].includes(key))) throw new TaskError('変更できない項目が含まれています');
    schedule(body.schedule, dates);
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 200) throw new TaskError('氏名は1〜200文字で入力してください');
    if (typeof body.role !== 'string' || !Object.hasOwn(legacyImport ? STAFF_ROLE_LABELS : STAFF_SELECTABLE_ROLE_LABELS, body.role)) throw new TaskError('外来講師・研究会講師・研究会サポートメンバーから選択してください');
    const values = object(body.responses);
    const keys = attendanceDateKeys(dates);
    if (Object.keys(values).length !== keys.length || keys.some(key => !Object.hasOwn(values, key))) throw new TaskError('各開催日の出欠予定を指定してください');
    if (Object.values(values).some(status => typeof status !== 'string' || !Object.hasOwn(STAFF_RESPONSE_LABELS, status))) throw new TaskError('出欠予定が不正です');
    return { name: body.name.trim(), role: body.role as StaffRole, responses: values as Record<string, StaffResponse>, schedule: dates };
  }
  function get(seminarId: number, id: number) {
    event(seminarId);
    const row = db.prepare('SELECT * FROM event_staff WHERE seminar_id=? AND id=?').get(seminarId, id) as PersonRow | undefined;
    if (!row) throw new TaskError('講師・サポートメンバーが見つかりません', 404);
    return toPerson(row);
  }
  function duplicate(seminarId: number, data: Pick<StaffInput, 'role' | 'name'>, except = 0) {
    return db.prepare('SELECT id FROM event_staff WHERE seminar_id=? AND role=? AND name=? AND id!=?').get(seminarId, data.role, data.name, except);
  }
  function record(seminarId: number, id: number, actorId: number, action: string, before: StaffPerson | null, after: StaffPerson | null) {
    // Keep the audit useful without copying names or other free text.
    const snapshot = (person: StaffPerson | null) => person ? JSON.stringify({ role: person.role, responses: person.responses }) : null;
    db.prepare(`INSERT INTO event_staff_history(seminar_id,person_id,actor_id,action,before_json,after_json)
      VALUES(?,?,?,?,?,?)`).run(seminarId, id, actorId, action, snapshot(before), snapshot(after));
  }
  function insert(seminarId: number, data: StaffInput, actorId: number) {
    if (duplicate(seminarId, data)) throw new TaskError('同じ役割・氏名が登録されています。登録済みの予定を編集してください', 409);
    const result = db.prepare('INSERT INTO event_staff(seminar_id,name,role,responses_json) VALUES(?,?,?,?)')
      .run(seminarId, data.name, data.role, JSON.stringify(data.responses));
    const person = get(seminarId, Number(result.lastInsertRowid));
    record(seminarId, person.id, actorId, 'created', null, person);
    return person;
  }
  return {
    get,
    list(seminarId: number): StaffAttendance {
      return db.transaction(() => {
        const row = event(seminarId);
        const people = (db.prepare("SELECT * FROM event_staff WHERE seminar_id=? ORDER BY CASE WHEN role IN ('LECTURER','EXTERNAL_LECTURER','SOCIETY_LECTURER') THEN 0 ELSE 1 END,id").all(seminarId) as PersonRow[]).map(toPerson);
        return { event_name: row.name, dates: row.dates, people };
      })();
    },
    create(seminarId: number, body: unknown, actorId: number) {
      return db.transaction(() => { actor(actorId); return insert(seminarId, input(body, event(seminarId).dates), actorId); }).immediate();
    },
    update(seminarId: number, id: number, body: unknown, actorId: number) {
      return db.transaction(() => {
        actor(actorId);
        const { version, ...fields } = object(body);
        const current = get(seminarId, id);
        if (parseVersion(version) !== current.version) throw new TaskError('別の操作で更新されています。入力を控え、最新情報を取得してください', 409);
        const data = input(fields, event(seminarId).dates);
        if (duplicate(seminarId, data, id)) throw new TaskError('同じ役割・氏名が登録されています', 409);
        const responses = { ...current.responses, ...data.responses };
        if (current.name !== data.name || current.role !== data.role) {
          db.prepare('DELETE FROM event_staff_directory_links WHERE person_id=?').run(id);
        }
        db.prepare(`UPDATE event_staff SET name=?,role=?,responses_json=?,version=version+1,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE seminar_id=? AND id=?`)
          .run(data.name, data.role, JSON.stringify(responses), seminarId, id);
        const updated = get(seminarId, id);
        record(seminarId, id, actorId, 'updated', current, updated);
        return updated;
      }).immediate();
    },
    remove(seminarId: number, id: number, body: unknown, actorId: number) {
      return db.transaction(() => {
        actor(actorId);
        const fields = object(body);
        if (Object.keys(fields).some(key => key !== 'version')) throw new TaskError('入力形式が不正です');
        const current = get(seminarId, id);
        if (parseVersion(fields.version) !== current.version) throw new TaskError('別の操作で更新されています。最新情報を取得してください', 409);
        db.prepare('DELETE FROM event_staff WHERE seminar_id=? AND id=?').run(seminarId, id);
        record(seminarId, id, actorId, 'deleted', current, null);
        return { success: true };
      }).immediate();
    },
    importNames(seminarId: number, body: unknown, actorId: number) {
      return db.transaction(() => {
        actor(actorId);
        const fields = object(body), row = event(seminarId);
        if (Object.keys(fields).some(key => key !== 'schedule')) throw new TaskError('入力形式が不正です');
        schedule(fields.schedule, row.dates);
        const external = row.external_lecturer ? JSON.parse(row.external_lecturer) as {status:string;name:string} : null;
        const candidates = [
          ...(external?.status==='YES' ? [{name:external.name,role:'EXTERNAL_LECTURER' as const}] : []),
          { name: row.lecturer_role==='EXTERNAL_LECTURER' && external?.status==='NO' ? '' : row.lecturer_name.trim(), role: row.lecturer_role ?? 'LECTURER' as StaffRole },
          ...(JSON.parse(row.assistant_members) as string[]).map(name => ({ name: name.trim(), role: 'SOCIETY_SUPPORT' as const })),
        ].filter(item => item.name);
        let added = 0;
        for (const candidate of candidates) {
          const roles = candidate.role === 'SOCIETY_SUPPORT' ? ['SOCIETY_SUPPORT', 'SUPPORT'] : ['EXTERNAL_LECTURER', 'SOCIETY_LECTURER', 'LECTURER'];
          if (roles.some(role => duplicate(seminarId, { ...candidate, role: role as StaffRole }))) continue;
          insert(seminarId, input({ ...candidate, schedule: row.dates,
            responses: Object.fromEntries(attendanceDateKeys(row.dates).map(date => [date, 'UNANSWERED'])) }, row.dates, true), actorId);
          added++;
        }
        return { added };
      }).immediate();
    },
    history(seminarId: number): StaffHistory[] {
      event(seminarId);
      const rows = db.prepare('SELECT * FROM event_staff_history WHERE seminar_id=? ORDER BY id DESC LIMIT 100').all(seminarId) as {
        id: number; person_id: number; actor_id: number; action: StaffHistory['action']; before_json: string | null; after_json: string | null; occurred_at: string;
      }[];
      return rows.map(row => ({ id: row.id, person_id: row.person_id, actor_id: row.actor_id, action: row.action,
        before: row.before_json ? JSON.parse(row.before_json) : null, after: row.after_json ? JSON.parse(row.after_json) : null, occurred_at: row.occurred_at }));
    },
  };
}
