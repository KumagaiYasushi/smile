import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { Seminar, SeminarInput } from '@/types/seminar';
import { emptySocialGathering, parseSocialGathering, mergeSocialGathering } from '../types/social-gathering.ts';
import { initVenueSchema, validateVenueLink } from './venues.ts';

export type { Seminar, SeminarInput } from '@/types/seminar';

// Runtime database files are provisioned separately, never bundled into deployments.
const DB_DIR = process.env.SMILE_DATA_DIR ?? path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'seminars.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  fs.mkdirSync(DB_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database) {
  initVenueSchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS seminars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      dates TEXT NOT NULL DEFAULT '[]',
      content TEXT DEFAULT '',
      lecturer_name TEXT DEFAULT '',
      assistant_members TEXT NOT NULL DEFAULT '[]',
      fee_dental_hygienist INTEGER DEFAULT 0,
      fee_dentist INTEGER DEFAULT 0,
      fee_other INTEGER DEFAULT 0,
      target_participants TEXT DEFAULT '',
      venue TEXT DEFAULT '',
      venue_fee INTEGER DEFAULT 0,
      sns_announcement TEXT DEFAULT '',
      lecturer_invitation_sent INTEGER DEFAULT 0,
      photo_received INTEGER DEFAULT 0,
      abstract_300_requested INTEGER DEFAULT 0,
      abstract_800_requested INTEGER DEFAULT 0,
      receipt_issued INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TRIGGER IF NOT EXISTS update_seminars_updated_at
    AFTER UPDATE ON seminars
    BEGIN
      UPDATE seminars SET updated_at = datetime('now', 'localtime') WHERE id = NEW.id;
    END;

    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'other',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      attended INTEGER DEFAULT 0,
      receipt_number TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TRIGGER IF NOT EXISTS update_participants_updated_at
    AFTER UPDATE ON participants
    BEGIN
      UPDATE participants SET updated_at = datetime('now', 'localtime') WHERE id = NEW.id;
    END;
  `);

  // Additive migration: retain existing IDs, dates, participants and checklist data.
  // Recheck inside the write transaction so concurrent first requests migrate once.
  db.transaction(() => {
    const columns = db.prepare('PRAGMA table_info(seminars)').all() as { name: string }[];
    if (!columns.some((column) => column.name === 'event_type')) {
      db.exec(`ALTER TABLE seminars ADD COLUMN event_type TEXT NOT NULL
        DEFAULT 'SEMINAR' CHECK (event_type IN ('BASIC_COURSE', 'LECTURE', 'SEMINAR'))`);
    }
    if (!columns.some((column) => column.name === 'delivery_method')) {
      // Do not infer a delivery method for historical records.
      db.exec(`ALTER TABLE seminars ADD COLUMN delivery_method TEXT
        CHECK (delivery_method IN ('ONSITE', 'ONLINE', 'HYBRID'))`);
    }
    if (!columns.some((column) => column.name === 'social_gathering')) {
      db.exec(`ALTER TABLE seminars ADD COLUMN social_gathering TEXT NOT NULL
        DEFAULT '{"status":"UNDECIDED","start_at":null,"end_at":null,"venue":"","fee":null}'
        CHECK (json_valid(social_gathering))`);
    }
    if (!columns.some((column) => column.name === 'venue_id')) {
      db.exec('ALTER TABLE seminars ADD COLUMN venue_id INTEGER REFERENCES venues(id) ON DELETE SET NULL');
    }
  }).immediate();
}

// ─── Seminar ─────────────────────────────────────────────────────────────────

type SeminarRow = Omit<Seminar, 'social_gathering' | 'dates' | 'assistant_members' | 'lecturer_invitation_sent' | 'photo_received' | 'abstract_300_requested' | 'abstract_800_requested' | 'receipt_issued'> & {
  social_gathering: string;
  dates: string;
  assistant_members: string;
  lecturer_invitation_sent: number;
  photo_received: number;
  abstract_300_requested: number;
  abstract_800_requested: number;
  receipt_issued: number;
};

function rowToSeminar(row: SeminarRow): Seminar {
  return {
    ...row,
    social_gathering: JSON.parse(row.social_gathering),
    dates: JSON.parse(row.dates),
    assistant_members: JSON.parse(row.assistant_members),
    lecturer_invitation_sent: Boolean(row.lecturer_invitation_sent),
    photo_received: Boolean(row.photo_received),
    abstract_300_requested: Boolean(row.abstract_300_requested),
    abstract_800_requested: Boolean(row.abstract_800_requested),
    receipt_issued: Boolean(row.receipt_issued),
  };
}

export function getAllSeminars(): Seminar[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM seminars ORDER BY created_at DESC').all() as SeminarRow[];
  return rows.map(rowToSeminar);
}

export function getSeminarById(id: number): Seminar | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM seminars WHERE id = ?').get(id) as SeminarRow | undefined;
  return row ? rowToSeminar(row) : null;
}

export function createSeminar(input: SeminarInput): Seminar {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO seminars (
      event_type, delivery_method, social_gathering, name, dates, content, lecturer_name, assistant_members,
      fee_dental_hygienist, fee_dentist, fee_other, target_participants,
      venue, venue_id, venue_fee, sns_announcement,
      lecturer_invitation_sent, photo_received, abstract_300_requested,
      abstract_800_requested, receipt_issued, notes
    ) VALUES (
      @event_type, @delivery_method, @social_gathering, @name, @dates, @content, @lecturer_name, @assistant_members,
      @fee_dental_hygienist, @fee_dentist, @fee_other, @target_participants,
      @venue, @venue_id, @venue_fee, @sns_announcement,
      @lecturer_invitation_sent, @photo_received, @abstract_300_requested,
      @abstract_800_requested, @receipt_issued, @notes
    )
  `);
  const result = stmt.run({
    ...input,
    delivery_method: input.delivery_method ?? null,
    venue_id: validateVenueLink(db, input.venue_id === undefined ? null : input.venue_id),
    social_gathering: JSON.stringify(parseSocialGathering(input.social_gathering === undefined ? emptySocialGathering() : input.social_gathering)),
    dates: JSON.stringify(input.dates),
    assistant_members: JSON.stringify(input.assistant_members),
    lecturer_invitation_sent: input.lecturer_invitation_sent ? 1 : 0,
    photo_received: input.photo_received ? 1 : 0,
    abstract_300_requested: input.abstract_300_requested ? 1 : 0,
    abstract_800_requested: input.abstract_800_requested ? 1 : 0,
    receipt_issued: input.receipt_issued ? 1 : 0,
  });
  return getSeminarById(result.lastInsertRowid as number)!;
}

export function updateSeminar(id: number, input: Partial<SeminarInput>): Seminar | null {
  const db = getDb();
  const current = getSeminarById(id);
  if (!current) return null;

  const merged = { ...current, ...input };
  db.prepare(`
    UPDATE seminars SET
      event_type = @event_type, delivery_method = @delivery_method, social_gathering = @social_gathering, name = @name, dates = @dates, content = @content,
      lecturer_name = @lecturer_name, assistant_members = @assistant_members,
      fee_dental_hygienist = @fee_dental_hygienist, fee_dentist = @fee_dentist,
      fee_other = @fee_other, target_participants = @target_participants,
      venue = @venue, venue_id = @venue_id, venue_fee = @venue_fee, sns_announcement = @sns_announcement,
      lecturer_invitation_sent = @lecturer_invitation_sent, photo_received = @photo_received,
      abstract_300_requested = @abstract_300_requested, abstract_800_requested = @abstract_800_requested,
      receipt_issued = @receipt_issued, notes = @notes
    WHERE id = @id
  `).run({
    id,
    event_type: merged.event_type,
    delivery_method: merged.delivery_method,
    social_gathering: JSON.stringify(input.social_gathering === undefined ? current.social_gathering : mergeSocialGathering(current.social_gathering, input.social_gathering)),
    name: merged.name,
    dates: JSON.stringify(merged.dates),
    content: merged.content,
    lecturer_name: merged.lecturer_name,
    assistant_members: JSON.stringify(merged.assistant_members),
    fee_dental_hygienist: merged.fee_dental_hygienist,
    fee_dentist: merged.fee_dentist,
    fee_other: merged.fee_other,
    target_participants: merged.target_participants,
    venue: merged.venue,
    venue_id: input.venue_id === undefined ? current.venue_id : validateVenueLink(db, input.venue_id, current.venue_id),
    venue_fee: merged.venue_fee,
    sns_announcement: merged.sns_announcement,
    lecturer_invitation_sent: merged.lecturer_invitation_sent ? 1 : 0,
    photo_received: merged.photo_received ? 1 : 0,
    abstract_300_requested: merged.abstract_300_requested ? 1 : 0,
    abstract_800_requested: merged.abstract_800_requested ? 1 : 0,
    receipt_issued: merged.receipt_issued ? 1 : 0,
    notes: merged.notes,
  });
  return getSeminarById(id);
}

export function deleteSeminar(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM seminars WHERE id = ?').run(id);
  return result.changes > 0;
}

// ─── Participant ─────────────────────────────────────────────────────────────

export type ParticipantRole = 'dental_hygienist' | 'dentist' | 'other';
export type PaymentStatus = 'unpaid' | 'paid';

export type Participant = {
  id: number;
  seminar_id: number;
  name: string;
  role: ParticipantRole;
  email: string;
  phone: string;
  payment_status: PaymentStatus;
  attended: boolean;
  receipt_number: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

type ParticipantRow = Omit<Participant, 'attended'> & { attended: number };

function rowToParticipant(row: ParticipantRow): Participant {
  return { ...row, attended: Boolean(row.attended) };
}

export function getParticipantsBySeminar(seminarId: number): Participant[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT * FROM participants WHERE seminar_id = ? ORDER BY created_at ASC')
    .all(seminarId) as ParticipantRow[];
  return rows.map(rowToParticipant);
}

export function getParticipantById(id: number): Participant | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM participants WHERE id = ?').get(id) as ParticipantRow | undefined;
  return row ? rowToParticipant(row) : null;
}

export type ParticipantInput = Omit<Participant, 'id' | 'created_at' | 'updated_at'>;

export function createParticipant(input: ParticipantInput): Participant {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO participants (seminar_id, name, role, email, phone, payment_status, attended, receipt_number, notes)
    VALUES (@seminar_id, @name, @role, @email, @phone, @payment_status, @attended, @receipt_number, @notes)
  `).run({ ...input, attended: input.attended ? 1 : 0 });
  return getParticipantById(result.lastInsertRowid as number)!;
}

export function updateParticipant(id: number, input: Partial<Omit<ParticipantInput, 'seminar_id'>>): Participant | null {
  const db = getDb();
  const current = getParticipantById(id);
  if (!current) return null;
  const merged = { ...current, ...input };
  db.prepare(`
    UPDATE participants SET
      name = @name, role = @role, email = @email, phone = @phone,
      payment_status = @payment_status, attended = @attended,
      receipt_number = @receipt_number, notes = @notes
    WHERE id = @id
  `).run({ ...merged, id, attended: merged.attended ? 1 : 0 });
  return getParticipantById(id);
}

export function deleteParticipant(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM participants WHERE id = ?').run(id);
  return result.changes > 0;
}
