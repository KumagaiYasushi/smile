import type Database from 'better-sqlite3';
import { TaskError, parseVersion } from '../types/task.ts';
import { requireDate } from '../types/task-template.ts';
import { parseLunch } from '../types/lunch.ts';
import type { LunchPlan, LunchInput, LunchSnapshot, LunchHistory } from '../types/lunch.ts';

export function createLunchStore(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_lunch_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
      input_json TEXT NOT NULL CHECK(json_valid(input_json)), version INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS event_lunch_event ON event_lunch_plans(seminar_id,id);
    CREATE TABLE IF NOT EXISTS event_lunch_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL, actor_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('created','updated','deleted')), before_json TEXT, after_json TEXT,
      occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS event_lunch_audit ON event_lunch_history(seminar_id,id);
  `);
  type Row = { id: number; seminar_id: number; version: number; updated_at: string; input_json: string };
  const plan = ({ input_json, ...row }: Row): LunchPlan => ({ ...JSON.parse(input_json), ...row });
  function event(id: number) {
    const row = db.prepare('SELECT name,dates FROM seminars WHERE id=?').get(id) as { name: string; dates: string } | undefined;
    if (!row) throw new TaskError('イベントが見つかりません', 404);
    return { name: row.name, dates: [...new Set((JSON.parse(row.dates) as string[]).map(date => requireDate(date)))].sort() };
  }
  function actor(id: number) {
    if (!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(id)) throw new TaskError('有効な運営メンバーとしてログインしてください', 403);
  }
  function object(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('昼食の入力形式が不正です');
    return value as Record<string, unknown>;
  }
  function input(value: unknown, dates: string[], previousDate?: string | null) {
    const { schedule, ...fields } = object(value);
    if (!Array.isArray(schedule) || schedule.some(date => typeof date !== 'string')) throw new TaskError('開催日の確認情報が必要です');
    if (JSON.stringify(schedule) !== JSON.stringify(dates)) throw new TaskError('開催日が変更されています。最新情報を取得して昼食の手配を確認してください', 409);
    const result = parseLunch(fields);
    if (result.date !== null && !dates.includes(result.date) && result.date !== previousDate) throw new TaskError('昼食の日付は開催日から選択してください');
    return result;
  }
  function get(seminarId: number, id: number) {
    event(seminarId);
    const row = db.prepare('SELECT * FROM event_lunch_plans WHERE seminar_id=? AND id=?').get(seminarId, id) as Row | undefined;
    if (!row) throw new TaskError('昼食の手配が見つかりません', 404);
    return plan(row);
  }
  function record(seminarId: number, id: number, actorId: number, action: string, before: LunchPlan | null, after: LunchPlan | null) {
    const snapshot = (value: LunchPlan | null): string | null => {
      if (!value) return null;
      const { date, target, quantity, unit_price, additional_cost, status } = value;
      const safe: LunchSnapshot = { date, target, quantity, unit_price, additional_cost, status,...(value.targets?{targets:value.targets}:{}),...(value.quantities?{quantities:value.quantities}:{}) };
      return JSON.stringify(safe);
    };
    db.prepare(`INSERT INTO event_lunch_history(seminar_id,plan_id,actor_id,action,before_json,after_json)
      VALUES(?,?,?,?,?,?)`).run(seminarId, id, actorId, action, snapshot(before), snapshot(after));
  }
  return {
    get,
    list(seminarId: number) {
      return db.transaction(() => {
        const row = event(seminarId);
        const plans = (db.prepare('SELECT * FROM event_lunch_plans WHERE seminar_id=? ORDER BY id').all(seminarId) as Row[]).map(plan);
        return { event_name: row.name, dates: row.dates, plans };
      })();
    },
    create(seminarId: number, body: unknown, actorId: number) {
      return db.transaction(() => {
        actor(actorId);
        const data = input(body, event(seminarId).dates);
        const result = db.prepare('INSERT INTO event_lunch_plans(seminar_id,input_json) VALUES(?,?)').run(seminarId, JSON.stringify(data));
        const created = get(seminarId, Number(result.lastInsertRowid));
        record(seminarId, created.id, actorId, 'created', null, created);
        return created;
      }).immediate();
    },
    update(seminarId: number, id: number, body: unknown, actorId: number) {
      return db.transaction(() => {
        actor(actorId);
        const { version, ...fields } = object(body), current = get(seminarId, id);
        if (parseVersion(version) !== current.version) throw new TaskError('別の操作で更新されています。入力を控えてキャンセルし、最新情報を取得してください', 409);
        const data: LunchInput = input(fields, event(seminarId).dates, current.date);
        db.prepare(`UPDATE event_lunch_plans SET input_json=?,version=version+1,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE seminar_id=? AND id=?`).run(JSON.stringify(data), seminarId, id);
        const updated = get(seminarId, id);
        record(seminarId, id, actorId, 'updated', current, updated);
        return updated;
      }).immediate();
    },
    remove(seminarId: number, id: number, body: unknown, actorId: number) {
      return db.transaction(() => {
        actor(actorId);
        const fields = object(body), current = get(seminarId, id);
        if (Object.keys(fields).some(key => key !== 'version')) throw new TaskError('入力形式が不正です');
        if (parseVersion(fields.version) !== current.version) throw new TaskError('別の操作で更新されています。最新情報を取得してください', 409);
        db.prepare('DELETE FROM event_lunch_plans WHERE seminar_id=? AND id=?').run(seminarId, id);
        record(seminarId, id, actorId, 'deleted', current, null);
        return { success: true };
      }).immediate();
    },
    history(seminarId: number): LunchHistory[] {
      event(seminarId);
      const rows = db.prepare('SELECT * FROM event_lunch_history WHERE seminar_id=? ORDER BY id DESC LIMIT 100').all(seminarId) as {
        id: number; plan_id: number; actor_id: number; action: LunchHistory['action']; before_json: string | null; after_json: string | null; occurred_at: string;
      }[];
      return rows.map(row => ({ id: row.id, plan_id: row.plan_id, actor_id: row.actor_id, action: row.action,
        before: row.before_json ? JSON.parse(row.before_json) : null, after: row.after_json ? JSON.parse(row.after_json) : null, occurred_at: row.occurred_at }));
    },
  };
}
