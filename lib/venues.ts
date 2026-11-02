import type Database from 'better-sqlite3';
import { TaskError, parseVersion } from '../types/task.ts';
import { parseVenue, VENUE_FIELDS } from '../types/venue.ts';
import type { Venue, VenueInput, VenueStatus, VenueHistory } from '../types/venue.ts';

export function initVenueSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS venues (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 200),
      room TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', access TEXT NOT NULL DEFAULT '',
      contact_person TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
      website TEXT NOT NULL DEFAULT '', capacity INTEGER CHECK(capacity>=0), reference_fee INTEGER CHECK(reference_fee>=0),
      fee_unit TEXT NOT NULL DEFAULT '', equipment TEXT NOT NULL DEFAULT '', booking_notes TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS venues_active_name ON venues(active,name,id);
    CREATE TABLE IF NOT EXISTS venue_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, venue_id INTEGER NOT NULL REFERENCES venues(id), actor_id INTEGER NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('created','updated')), changed_fields_json TEXT NOT NULL,
      before_json TEXT, after_json TEXT NOT NULL,
      occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS venue_history_venue ON venue_history(venue_id,id);
  `);
}
export function validateVenueLink(db: Database.Database, value: unknown, previousId: number | null = null): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TaskError('会場台帳のIDが不正です');
  const row = db.prepare('SELECT active FROM venues WHERE id=?').get(value) as { active: number } | undefined;
  if (!row) throw new TaskError('会場台帳の登録が見つかりません');
  if (!row.active && value !== previousId) throw new TaskError('利用停止の会場は新しく選択できません');
  return value;
}
export function createVenueStore(db: Database.Database) {
  initVenueSchema(db);
  type Row = Omit<Venue, 'active'> & { active: number };
  const venue = (row: Row): Venue => ({ ...row, active: Boolean(row.active) });
  const bindings = (input: VenueInput) => ({ ...input, active: input.active ? 1 : 0 });
  function actor(id: number) {
    if (!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(id)) throw new TaskError('有効な運営メンバーとしてログインしてください', 403);
  }
  function get(id: number) {
    const row = db.prepare('SELECT * FROM venues WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new TaskError('会場が見つかりません', 404);
    return venue(row);
  }
  function record(id: number, actorId: number, before: Venue | null, after: Venue, changed: (keyof VenueInput)[]) {
    const snapshot = (value: Venue | null) => value ? JSON.stringify({ active: value.active, capacity: value.capacity, reference_fee: value.reference_fee }) : null;
    db.prepare(`INSERT INTO venue_history(venue_id,actor_id,action,changed_fields_json,before_json,after_json)
      VALUES(?,?,?,?,?,?)`).run(id, actorId, before ? 'updated' : 'created', JSON.stringify(changed), snapshot(before), snapshot(after));
  }
  return {
    get,
    list(query = '', status: VenueStatus = 'ACTIVE') {
      if (typeof query !== 'string' || query.length > 200 || !['ACTIVE', 'INACTIVE', 'ALL'].includes(status)) throw new TaskError('会場の検索条件が不正です');
      const pattern = `%${query.trim().replace(/[\\%_]/g, '\\$&')}%`;
      const rows = db.prepare(`SELECT * FROM venues WHERE (@status='ALL' OR active=(@status='ACTIVE'))
        AND (name LIKE @query ESCAPE '\\' OR room LIKE @query ESCAPE '\\' OR address LIKE @query ESCAPE '\\'
          OR contact_person LIKE @query ESCAPE '\\') ORDER BY name COLLATE NOCASE,room,id`).all({ status, query: pattern }) as Row[];
      return rows.map(venue);
    },
    create(body: unknown, actorId: number) {
      return db.transaction(() => {
        actor(actorId); const input = parseVenue(body);
        const result = db.prepare(`INSERT INTO venues(${VENUE_FIELDS.join(',')}) VALUES(${VENUE_FIELDS.map(key => `@${key}`).join(',')})`).run(bindings(input));
        const created = get(Number(result.lastInsertRowid));
        record(created.id, actorId, null, created, [...VENUE_FIELDS]);
        return created;
      }).immediate();
    },
    update(id: number, body: unknown, actorId: number) {
      return db.transaction(() => {
        actor(actorId);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TaskError('入力形式が不正です');
        const { version, ...fields } = body as Record<string, unknown>, current = get(id);
        if (parseVersion(version) !== current.version) throw new TaskError('別の操作で更新されています。入力を控えてキャンセルし、最新情報を取得してください', 409);
        const input = parseVenue(fields, current);
        const changed = VENUE_FIELDS.filter(key => current[key] !== input[key]);
        if (!changed.length) return current;
        db.prepare(`UPDATE venues SET ${VENUE_FIELDS.map(key => `${key}=@${key}`).join(',')},version=version+1,
          updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=@id`).run({ ...bindings(input), id });
        const updated = get(id); record(id, actorId, current, updated, changed);
        return updated;
      }).immediate();
    },
    history(id: number): VenueHistory[] {
      get(id);
      const rows = db.prepare('SELECT * FROM venue_history WHERE venue_id=? ORDER BY id DESC LIMIT 100').all(id) as {
        id: number; venue_id: number; actor_id: number; action: VenueHistory['action']; changed_fields_json: string; before_json: string | null; after_json: string; occurred_at: string;
      }[];
      return rows.map(row => ({ id: row.id, venue_id: row.venue_id, actor_id: row.actor_id, action: row.action,
        changed_fields: JSON.parse(row.changed_fields_json), before: row.before_json ? JSON.parse(row.before_json) : null,
        after: JSON.parse(row.after_json), occurred_at: row.occurred_at }));
    },
  };
}
