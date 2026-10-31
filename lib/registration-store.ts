import type Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { EventError, EventStore } from './event-store.ts';
import type { AdmissionAudit, AdmissionSummary, Contact, ContactRevision, ParticipantDetail, ParticipantMaster, ParticipantSearch, Registration } from '../types/registration.ts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new EventError('入力内容を確認してください');
  return value as Record<string, unknown>;
}
function fields(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new EventError('未対応の項目が含まれています');
}
function contact(raw: unknown): Contact {
  const input = object(raw); fields(input, ['name', 'mobile', 'email', 'workplace']);
  const result: Contact = { name: '', mobile: '', email: '', workplace: '' };
  for (const key of Object.keys(result) as (keyof Contact)[]) {
    const value = input[key] ?? '';
    if (typeof value !== 'string' || value.length > (key === 'mobile' ? 64 : key === 'email' ? 254 : 500) || /[\u0000-\u001f\u007f]/.test(value)) throw new EventError('文字項目の長さ・入力を確認してください');
    // Preserve the original spelling, spaces, case and phone punctuation for exact matching.
    result[key] = value;
  }
  if (!Object.values(result).some(value => value.trim())) throw new EventError('少なくとも1つの参加者情報を入力してください');
  if (result.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(result.email)) throw new EventError('メールアドレスの形式を確認してください');
  return result;
}
type RegistrationRow = Omit<Registration, 'snapshot' | 'candidate_ids' | 'attendance_status' | 'confirmed_at'> & { snapshot_json: string; confirmed_at: number | null };
const registrationQuery = 'SELECT r.*,s.snapshot_json,c.confirmed_at,c.confirmed_by FROM registrations r JOIN registration_snapshots s ON s.registration_id=r.id LEFT JOIN registration_confirmations c ON c.registration_id=r.id';

export class RegistrationStore {
  private db: Database.Database;
  private now: () => number;
  constructor(db: Database.Database, now = () => Date.now()) {
    this.db = db;
    this.now = now;
    // Legacy participants remain untouched; this is the cross-event master.
    db.exec(`
      CREATE TABLE IF NOT EXISTS participant_masters (
        id INTEGER PRIMARY KEY, current_name TEXT NOT NULL, current_mobile TEXT NOT NULL,
        current_email TEXT NOT NULL, current_workplace TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS participant_exact_match ON participant_masters(current_name,current_mobile);
      CREATE TABLE IF NOT EXISTS registrations (
        id INTEGER PRIMARY KEY, participant_id INTEGER NOT NULL REFERENCES participant_masters(id),
        event_id INTEGER NOT NULL REFERENCES events(id), match_status TEXT NOT NULL
          CHECK(match_status IN ('EXACT','NEW','MISSING_KEYS','AMBIGUOUS')),
        application_status TEXT NOT NULL DEFAULT 'PENDING_REVIEW' CHECK(application_status='PENDING_REVIEW'),
        source_type TEXT NOT NULL DEFAULT 'MANUAL' CHECK(source_type='MANUAL'),
        source_key TEXT NOT NULL UNIQUE, request_fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS registrations_event ON registrations(event_id,id);
      CREATE INDEX IF NOT EXISTS registrations_participant ON registrations(participant_id,id);
      CREATE TABLE IF NOT EXISTS registration_snapshots (
        registration_id INTEGER PRIMARY KEY REFERENCES registrations(id), snapshot_json TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS immutable_registration_snapshot BEFORE UPDATE ON registration_snapshots
        BEGIN SELECT RAISE(ABORT,'Registration snapshots are immutable'); END;
      CREATE TABLE IF NOT EXISTS registration_match_candidates (
        registration_id INTEGER NOT NULL REFERENCES registrations(id), participant_id INTEGER NOT NULL REFERENCES participant_masters(id),
        PRIMARY KEY(registration_id,participant_id)
      );
      CREATE TABLE IF NOT EXISTS participant_contact_histories (
        participant_id INTEGER NOT NULL REFERENCES participant_masters(id), version INTEGER NOT NULL,
        actor_id INTEGER NOT NULL REFERENCES users(id), source_registration_id INTEGER REFERENCES registrations(id),
        changed_fields_json TEXT NOT NULL, before_json TEXT, after_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY(participant_id,version)
      );
      CREATE TABLE IF NOT EXISTS participant_audit_logs (
        id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL REFERENCES users(id), participant_id INTEGER NOT NULL REFERENCES participant_masters(id),
        registration_id INTEGER REFERENCES registrations(id), action TEXT NOT NULL, changed_fields_json TEXT NOT NULL,
        occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);
    this.initAdmissions();
  }
  private initAdmissions() {
    // Additive migration: retain the old pending column and immutable snapshots.
    // Effective status is derived from the unique seat allocation, never dual-written.
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS registrations_identity ON registrations(id,event_id,participant_id);
      CREATE TABLE IF NOT EXISTS registration_confirmations (
        registration_id INTEGER PRIMARY KEY,
        event_id INTEGER NOT NULL, participant_id INTEGER NOT NULL,
        confirmed_by INTEGER NOT NULL REFERENCES users(id), confirmed_at INTEGER NOT NULL,
        FOREIGN KEY(registration_id,event_id,participant_id) REFERENCES registrations(id,event_id,participant_id),
        UNIQUE(event_id,participant_id)
      );
      CREATE TABLE IF NOT EXISTS admission_audit_logs (
        id INTEGER PRIMARY KEY, event_id INTEGER NOT NULL REFERENCES events(id),
        actor_id INTEGER NOT NULL REFERENCES users(id), registration_id INTEGER REFERENCES registrations(id),
        action TEXT NOT NULL CHECK(action IN ('CONFIRMED','CAPACITY_CHANGED')),
        before_capacity INTEGER, after_capacity INTEGER,
        occurred_at TEXT NOT NULL
      );
      CREATE TRIGGER IF NOT EXISTS guard_confirmation_capacity BEFORE INSERT ON registration_confirmations
      WHEN (SELECT capacity FROM events WHERE id=NEW.event_id) IS NULL OR
        (SELECT COUNT(*) FROM registration_confirmations WHERE event_id=NEW.event_id)>=(SELECT capacity FROM events WHERE id=NEW.event_id)
      BEGIN SELECT RAISE(ABORT,'Capacity unavailable'); END;
      CREATE TRIGGER IF NOT EXISTS guard_capacity_reduction BEFORE UPDATE OF capacity ON events
      WHEN EXISTS(SELECT 1 FROM registration_confirmations WHERE event_id=OLD.id) AND
        (NEW.capacity IS NULL OR NEW.capacity<(SELECT COUNT(*) FROM registration_confirmations WHERE event_id=OLD.id))
      BEGIN SELECT RAISE(ABORT,'Capacity below confirmed count'); END;
    `);
  }
  private actor(id: number) {
    if (!this.db.prepare('SELECT id FROM users WHERE id=? AND active=1').get(id)) throw new EventError('有効な運営メンバーを確認してください', 403);
  }
  private master(id: number) {
    const row = this.db.prepare('SELECT * FROM participant_masters WHERE id=?').get(id) as ParticipantMaster | undefined;
    if (!row) throw new EventError('参加者が見つかりません', 404);
    return row;
  }
  private values(master: ParticipantMaster): Contact {
    return { name: master.current_name, mobile: master.current_mobile, email: master.current_email, workplace: master.current_workplace };
  }
  private audit(actor: number, participant: number, registration: number | null, action: string, changed: string[]) {
    this.db.prepare('INSERT INTO participant_audit_logs(actor_id,participant_id,registration_id,action,changed_fields_json) VALUES (?,?,?,?,?)')
      .run(actor, participant, registration, action, JSON.stringify(changed));
  }
  private registration(row: RegistrationRow): Registration {
    return { id: row.id, event_id: row.event_id, participant_id: row.participant_id, match_status: row.match_status,
      application_status: row.confirmed_at === null ? 'PENDING_REVIEW' : 'CONFIRMED',
      confirmed_at: row.confirmed_at === null ? null : new Date(row.confirmed_at).toISOString(), confirmed_by: row.confirmed_by,
      created_at: row.created_at, snapshot: JSON.parse(row.snapshot_json),
      candidate_ids: (this.db.prepare('SELECT participant_id FROM registration_match_candidates WHERE registration_id=? ORDER BY participant_id').all(row.id) as { participant_id: number }[]).map(item => item.participant_id),
      attendance_status: 'UNVERIFIED',
    };
  }
  getRegistration(id: number): Registration {
    const row = this.db.prepare(`${registrationQuery} WHERE r.id=?`).get(id) as RegistrationRow | undefined;
    if (!row) throw new EventError('申込が見つかりません', 404);
    return this.registration(row);
  }
  register(eventId: number, raw: unknown, actor: number): Registration {
    const input = object(raw); fields(input, ['request_key', 'snapshot']);
    if (typeof input.request_key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.request_key)) throw new EventError('登録キーが不正です。画面を再読み込みしてください');
    const key = input.request_key.toLowerCase(), snapshot = contact(input.snapshot);
    const fingerprint = createHash('sha256').update(JSON.stringify([eventId, snapshot])).digest('hex');
    return this.db.transaction(() => {
      this.actor(actor);
      const existing = this.db.prepare('SELECT id,request_fingerprint FROM registrations WHERE source_key=?').get(key) as { id: number; request_fingerprint: string } | undefined;
      if (existing) {
        if (existing.request_fingerprint !== fingerprint) throw new EventError('同じ登録操作で内容が変わっています。登録済みの申込を確認してください', 409);
        return this.getRegistration(existing.id);
      }
      if (!this.db.prepare('SELECT id FROM events WHERE id=?').get(eventId)) throw new EventError('イベントが見つかりません', 404);
      const hasKeys = Boolean(snapshot.name.trim() && snapshot.mobile.trim());
      const candidates = hasKeys ? this.db.prepare('SELECT id FROM participant_masters WHERE current_name=? COLLATE BINARY AND current_mobile=? COLLATE BINARY ORDER BY id').all(snapshot.name, snapshot.mobile) as { id: number }[] : [];
      const match: Registration['match_status'] = !hasKeys ? 'MISSING_KEYS' : candidates.length === 1 ? 'EXACT' : candidates.length > 1 ? 'AMBIGUOUS' : 'NEW';
      const isNew = match !== 'EXACT';
      const participantId = isNew ? Number(this.db.prepare('INSERT INTO participant_masters(current_name,current_mobile,current_email,current_workplace) VALUES (?,?,?,?)')
        .run(snapshot.name, snapshot.mobile, snapshot.email, snapshot.workplace).lastInsertRowid) : candidates[0].id;
      const registrationId = Number(this.db.prepare('INSERT INTO registrations(participant_id,event_id,match_status,source_key,request_fingerprint) VALUES (?,?,?,?,?)')
        .run(participantId, eventId, match, key, fingerprint).lastInsertRowid);
      this.db.prepare('INSERT INTO registration_snapshots VALUES (?,?)').run(registrationId, JSON.stringify(snapshot));
      if (match === 'AMBIGUOUS') for (const candidate of candidates) this.db.prepare('INSERT INTO registration_match_candidates VALUES (?,?)').run(registrationId, candidate.id);
      if (isNew) this.db.prepare('INSERT INTO participant_contact_histories(participant_id,version,actor_id,source_registration_id,changed_fields_json,after_json) VALUES (?,1,?,?,?,?)')
        .run(participantId, actor, registrationId, JSON.stringify(Object.keys(snapshot)), JSON.stringify(snapshot));
      this.audit(actor, participantId, registrationId, match === 'AMBIGUOUS' ? 'registration_needs_review' : 'registration_recorded', []);
      return this.getRegistration(registrationId);
    }).immediate();
  }
  search(query = '', page = 1): ParticipantSearch {
    if (typeof query !== 'string' || query.length > 100 || !Number.isSafeInteger(page) || page < 1 || page > 1000000) throw new EventError('検索条件を確認してください');
    const like = `%${query.replace(/[\\%_]/g, char => `\\${char}`)}%`;
    const where = "WHERE current_name LIKE ? ESCAPE '\\' OR current_mobile LIKE ? ESCAPE '\\' OR current_email LIKE ? ESCAPE '\\' OR current_workplace LIKE ? ESCAPE '\\'";
    const args = [like, like, like, like];
    const total = (this.db.prepare(`SELECT COUNT(*) as n FROM participant_masters ${where}`).get(...args) as { n: number }).n;
    const items = this.db.prepare(`SELECT p.*, (SELECT count(*) FROM registrations r WHERE r.participant_id=p.id) as registration_count FROM participant_masters p ${where} ORDER BY id DESC LIMIT 30 OFFSET ?`).all(...args, (page - 1) * 30) as ParticipantSearch['items'];
    return { items, total, page, page_size: 30 };
  }
  forEvent(eventId: number) {
    if (!this.db.prepare('SELECT id FROM events WHERE id=?').get(eventId)) throw new EventError('イベントが見つかりません', 404);
    return (this.db.prepare(`${registrationQuery} WHERE r.event_id=? ORDER BY r.id DESC`).all(eventId) as RegistrationRow[]).map(row => this.registration(row));
  }
  detail(id: number): ParticipantDetail {
    const master = this.master(id);
    const rows = this.db.prepare(`${registrationQuery.replace('SELECT r.*', 'SELECT e.title as event_title,r.*')} JOIN events e ON e.id=r.event_id WHERE r.participant_id=? ORDER BY r.id DESC`).all(id) as (RegistrationRow & { event_title: string })[];
    const histories = this.db.prepare('SELECT * FROM participant_contact_histories WHERE participant_id=? ORDER BY version DESC').all(id) as { version: number; actor_id: number; changed_fields_json: string; before_json: string | null; after_json: string; occurred_at: string }[];
    const revisions: ContactRevision[] = histories.map(row => ({ version: row.version, actor_id: row.actor_id, changed_fields: JSON.parse(row.changed_fields_json), before: row.before_json ? JSON.parse(row.before_json) : null, after: JSON.parse(row.after_json), occurred_at: row.occurred_at }));
    return { ...master, registrations: rows.map(row => ({ ...this.registration(row), event_title: row.event_title })), revisions };
  }
  update(id: number, raw: unknown, actor: number) {
    const input = object(raw); fields(input, ['version', 'contact']);
    if (!Number.isSafeInteger(input.version) || (input.version as number) < 1) throw new EventError('バージョンが不正です');
    const after = contact(input.contact);
    return this.db.transaction(() => {
      this.actor(actor); const master = this.master(id), before = this.values(master);
      if (master.version !== input.version) throw new EventError('他の人が更新しました。最新情報を再読み込みしてください', 409);
      const changed = (Object.keys(after) as (keyof Contact)[]).filter(key => after[key] !== before[key]);
      if (!changed.length) return this.detail(id);
      this.db.prepare('UPDATE participant_masters SET current_name=?,current_mobile=?,current_email=?,current_workplace=?,version=version+1 WHERE id=?')
        .run(after.name, after.mobile, after.email, after.workplace, id);
      this.db.prepare('INSERT INTO participant_contact_histories(participant_id,version,actor_id,changed_fields_json,before_json,after_json) VALUES (?,?,?,?,?,?)')
        .run(id, master.version + 1, actor, JSON.stringify(changed), JSON.stringify(before), JSON.stringify(after));
      this.audit(actor, id, null, 'representative_contact_updated', changed);
      return this.detail(id);
    }).immediate();
  }
  admission(eventId: number): AdmissionSummary {
    const event = this.db.prepare('SELECT capacity,application_deadline,version FROM events WHERE id=?').get(eventId) as { capacity: number | null; application_deadline: string | null; version: number } | undefined;
    if (!event) throw new EventError('イベントが見つかりません', 404);
    const confirmed = (this.db.prepare('SELECT COUNT(*) as n FROM registration_confirmations WHERE event_id=?').get(eventId) as { n: number }).n;
    const total = (this.db.prepare('SELECT COUNT(*) as n FROM registrations WHERE event_id=?').get(eventId) as { n: number }).n;
    return { event_id: eventId, event_version: event.version, capacity: event.capacity, confirmed_count: confirmed, pending_count: total - confirmed,
      remaining: event.capacity === null ? null : Math.max(0, event.capacity - confirmed), deadline: event.application_deadline,
      state: event.application_deadline && this.now() >= Date.parse(event.application_deadline) ? 'DEADLINE_PASSED' : event.capacity === null ? 'UNCONFIGURED' : confirmed >= event.capacity ? 'FULL' : 'OPEN',
    };
  }
  confirm(id: number, raw: unknown, actor: number) {
    const input = object(raw); fields(input, ['reviewed', 'event_version']);
    if (input.reviewed !== true || !Number.isSafeInteger(input.event_version) || (input.event_version as number) < 1) throw new EventError('申込情報と照合結果を確認してください');
    return this.db.transaction(() => {
      this.actor(actor); const registration = this.getRegistration(id);
      // A lost response may be retried even after the event has filled/closed.
      if (registration.application_status === 'CONFIRMED') return registration;
      const summary = this.admission(registration.event_id);
      if (summary.event_version !== input.event_version) throw new EventError('イベント設定が更新されています。再読み込みして確認してください', 409);
      if (summary.state === 'UNCONFIGURED') throw new EventError('定員を設定してから受付を確定してください', 409);
      if (summary.state === 'DEADLINE_PASSED') throw new EventError('申込締切を過ぎているため確定できません', 409);
      if (summary.state === 'FULL') throw new EventError('満席のため確定できません', 409);
      if (this.db.prepare('SELECT 1 FROM registration_confirmations WHERE event_id=? AND participant_id=?').get(registration.event_id, registration.participant_id)) throw new EventError('この参加者は同じイベントで既に受付確定しています。申込を確認してください', 409);
      const now = this.now();
      if (summary.deadline && now >= Date.parse(summary.deadline)) throw new EventError('申込締切を過ぎているため確定できません', 409);
      this.db.prepare('INSERT INTO registration_confirmations(registration_id,event_id,participant_id,confirmed_by,confirmed_at) VALUES (?,?,?,?,?)')
        .run(id, registration.event_id, registration.participant_id, actor, now);
      this.db.prepare("INSERT INTO admission_audit_logs(event_id,actor_id,registration_id,action,occurred_at) VALUES (?,?,?,'CONFIRMED',?)")
        .run(registration.event_id, actor, id, new Date(now).toISOString());
      return this.getRegistration(id);
    }).immediate();
  }
  setCapacity(eventId: number, raw: unknown, actor: number) {
    const input = object(raw); fields(input, ['capacity', 'event_version']);
    if (!Number.isSafeInteger(input.capacity) || (input.capacity as number) < 1 || (input.capacity as number) > 100000 || !Number.isSafeInteger(input.event_version)) throw new EventError('定員は1〜100000の整数で入力してください');
    return this.db.transaction(() => {
      this.actor(actor); const before = this.admission(eventId);
      if (before.event_version !== input.event_version) throw new EventError('イベント設定が更新されています。再読み込みしてください', 409);
      if ((input.capacity as number) < before.confirmed_count) throw new EventError('受付確定人数より少ない定員には変更できません', 409);
      if (input.capacity === before.capacity) return before;
      this.db.prepare('UPDATE events SET capacity=?,version=version+1 WHERE id=?').run(input.capacity, eventId);
      this.db.prepare("INSERT INTO admission_audit_logs(event_id,actor_id,action,before_capacity,after_capacity,occurred_at) VALUES (?,?,'CAPACITY_CHANGED',?,?,?)")
        .run(eventId, actor, before.capacity, input.capacity, new Date(this.now()).toISOString());
      return this.admission(eventId);
    }).immediate();
  }
  admissionHistory(eventId: number) {
    this.admission(eventId);
    return this.db.prepare('SELECT id,actor_id,registration_id,action,before_capacity,after_capacity,occurred_at FROM admission_audit_logs WHERE event_id=? ORDER BY id DESC LIMIT 100').all(eventId) as AdmissionAudit[];
  }
}

export function registrationStore(db: Database.Database) {
  new EventStore(db); // Create parent event tables idempotently before adding the new schema.
  return new RegistrationStore(db);
}
