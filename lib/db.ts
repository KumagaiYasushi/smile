import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DB_DIR, 'seminars.db');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  initSchema(db);
  return db;
}

function initSchema(db: Database.Database) {
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
      -- チェックリスト項目
      lecturer_invitation_sent INTEGER DEFAULT 0,
      photo_received INTEGER DEFAULT 0,
      abstract_300_requested INTEGER DEFAULT 0,
      abstract_800_requested INTEGER DEFAULT 0,
      receipt_issued INTEGER DEFAULT 0,
      -- メモ
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      updated_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TRIGGER IF NOT EXISTS update_seminars_updated_at
    AFTER UPDATE ON seminars
    BEGIN
      UPDATE seminars SET updated_at = datetime('now', 'localtime') WHERE id = NEW.id;
    END;
  `);
}

export type Seminar = {
  id: number;
  name: string;
  dates: string[];
  content: string;
  lecturer_name: string;
  assistant_members: string[];
  fee_dental_hygienist: number;
  fee_dentist: number;
  fee_other: number;
  target_participants: string;
  venue: string;
  venue_fee: number;
  sns_announcement: string;
  lecturer_invitation_sent: boolean;
  photo_received: boolean;
  abstract_300_requested: boolean;
  abstract_800_requested: boolean;
  receipt_issued: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
};

type SeminarRow = Omit<Seminar, 'dates' | 'assistant_members' | 'lecturer_invitation_sent' | 'photo_received' | 'abstract_300_requested' | 'abstract_800_requested' | 'receipt_issued'> & {
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

export type SeminarInput = Omit<Seminar, 'id' | 'created_at' | 'updated_at'>;

export function createSeminar(input: SeminarInput): Seminar {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO seminars (
      name, dates, content, lecturer_name, assistant_members,
      fee_dental_hygienist, fee_dentist, fee_other, target_participants,
      venue, venue_fee, sns_announcement,
      lecturer_invitation_sent, photo_received, abstract_300_requested,
      abstract_800_requested, receipt_issued, notes
    ) VALUES (
      @name, @dates, @content, @lecturer_name, @assistant_members,
      @fee_dental_hygienist, @fee_dentist, @fee_other, @target_participants,
      @venue, @venue_fee, @sns_announcement,
      @lecturer_invitation_sent, @photo_received, @abstract_300_requested,
      @abstract_800_requested, @receipt_issued, @notes
    )
  `);
  const result = stmt.run({
    ...input,
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
      name = @name, dates = @dates, content = @content,
      lecturer_name = @lecturer_name, assistant_members = @assistant_members,
      fee_dental_hygienist = @fee_dental_hygienist, fee_dentist = @fee_dentist,
      fee_other = @fee_other, target_participants = @target_participants,
      venue = @venue, venue_fee = @venue_fee, sns_announcement = @sns_announcement,
      lecturer_invitation_sent = @lecturer_invitation_sent, photo_received = @photo_received,
      abstract_300_requested = @abstract_300_requested, abstract_800_requested = @abstract_800_requested,
      receipt_issued = @receipt_issued, notes = @notes
    WHERE id = @id
  `).run({
    id,
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
