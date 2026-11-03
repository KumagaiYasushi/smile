import {resolveSpeakers} from './speakers.ts';
import {eventSpeakers,speakerPaymentTotal} from '../types/speaker.ts';
import {resolveSocialAttendance} from './social-attendance.ts';
import {allowOtherEvents} from './event-type-migration.ts';
import {emptyExternalPayment,parseExternalPayment} from '../types/external-payment.ts';
import {allAudienceRoles,parseAudienceRoles,audienceText} from '../types/audience.ts';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import type { Seminar, SeminarInput } from '@/types/seminar';
import { emptySocialGathering, parseSocialGathering, mergeSocialGathering } from '../types/social-gathering.ts';
import { initVenueSchema, validateVenueLink } from './venues.ts';
import { eventDates, validateOccurrences, parseEventTimes } from '../types/event-schedule.ts';
import { TaskError } from '../types/task.ts';
import { parseParticipant } from '../types/participant.ts';
import type { Participant, ParticipantRole, PaymentStatus, ParticipantFields } from '../types/participant.ts';
import { parseSessionMethods,parseRepeatFees,emptyRepeatFees } from '../types/event-options.ts';
import {initExternalLecturers,resolveExternalSelection} from './external-lecturers.ts';
import {emptyExternal} from '../types/external-lecturer.ts';
import { initReceiptSchema } from './receipts.ts';

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
  initExternalLecturers(db);
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
    if (!columns.some(column => column.name === 'speakers')) db.exec("ALTER TABLE seminars ADD COLUMN speakers TEXT CHECK(speakers IS NULL OR json_valid(speakers))");
    if (!columns.some((column) => column.name === 'event_type')) {
      db.exec(`ALTER TABLE seminars ADD COLUMN event_type TEXT NOT NULL
        DEFAULT 'SEMINAR' CHECK (event_type IN ('BASIC_COURSE', 'LECTURE', 'SEMINAR', 'OTHER'))`);
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
    if (!columns.some(column => column.name === 'occurrence_type')) db.exec("ALTER TABLE seminars ADD COLUMN occurrence_type TEXT CHECK(occurrence_type IN ('SINGLE','MULTIPLE'))");
    if (!columns.some(column => column.name === 'event_times')) db.exec("ALTER TABLE seminars ADD COLUMN event_times TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(event_times))");
    if (!columns.some(column => column.name === 'session_delivery_methods')) db.exec("ALTER TABLE seminars ADD COLUMN session_delivery_methods TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(session_delivery_methods))");
    if (!columns.some(column => column.name === 'repeat_fees')) db.exec("ALTER TABLE seminars ADD COLUMN repeat_fees TEXT NOT NULL DEFAULT '{\"dental_hygienist\":null,\"dentist\":null,\"other\":null}' CHECK(json_valid(repeat_fees))");
    if (!columns.some(column => column.name === 'external_payment')) db.exec("ALTER TABLE seminars ADD COLUMN external_payment TEXT NOT NULL DEFAULT '{\"travel\":null,\"honorarium\":null}' CHECK(json_valid(external_payment))");
    if (!columns.some(column => column.name === 'audience_roles')) db.exec("ALTER TABLE seminars ADD COLUMN audience_roles TEXT CHECK(audience_roles IS NULL OR json_valid(audience_roles))");
    if (!columns.some(column => column.name === 'external_lecturer')) db.exec("ALTER TABLE seminars ADD COLUMN external_lecturer TEXT NOT NULL DEFAULT '{\"status\":\"UNDECIDED\",\"id\":null,\"name\":\"\",\"facility\":\"\"}' CHECK(json_valid(external_lecturer))");
    if (!columns.some(column => column.name === 'lecturer_role')) db.exec("ALTER TABLE seminars ADD COLUMN lecturer_role TEXT CHECK(lecturer_role IN ('EXTERNAL_LECTURER','SOCIETY_LECTURER'))");
  }).immediate();
  db.transaction(() => {
    const columns = db.prepare('PRAGMA table_info(participants)').all() as { name: string }[];
    if (!columns.some(column => column.name === 'payment_method')) db.exec("ALTER TABLE participants ADD COLUMN payment_method TEXT CHECK(payment_method IN ('bank_transfer','cash','other'))");
    if (!columns.some(column => column.name === 'paid_amount')) db.exec('ALTER TABLE participants ADD COLUMN paid_amount INTEGER CHECK(paid_amount>=0)');
    if (!columns.some(column => column.name === 'payment_confirmed_at')) db.exec('ALTER TABLE participants ADD COLUMN payment_confirmed_at TEXT');
    if (!columns.some(column => column.name === 'payment_confirmed_by')) db.exec('ALTER TABLE participants ADD COLUMN payment_confirmed_by INTEGER');
  }).immediate();
  initReceiptSchema(db);
  allowOtherEvents(db);
}

// ─── Seminar ─────────────────────────────────────────────────────────────────

type SeminarRow = Omit<Seminar, 'speakers' | 'external_payment' | 'audience_roles' | 'external_lecturer' | 'session_delivery_methods' | 'repeat_fees' | 'event_times' | 'social_gathering' | 'dates' | 'assistant_members' | 'lecturer_invitation_sent' | 'photo_received' | 'abstract_300_requested' | 'abstract_800_requested' | 'receipt_issued'> & {
  speakers:string|null;
  external_lecturer:string;
  external_payment:string;
  audience_roles:string|null;
  session_delivery_methods: string;
  repeat_fees: string;
  event_times: string;
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
    speakers:row.speakers===null?null:JSON.parse(row.speakers),
    external_lecturer:JSON.parse(row.external_lecturer),
    external_payment:JSON.parse(row.external_payment),
    audience_roles:row.audience_roles===null?null:JSON.parse(row.audience_roles),
    event_times: JSON.parse(row.event_times),
    session_delivery_methods: JSON.parse(row.session_delivery_methods),
    repeat_fees: JSON.parse(row.repeat_fees),
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

export function createSeminar(input: SeminarInput, actorId?:number): Seminar {
  const db = getDb();
  if(input.target_participants!==undefined&&typeof input.target_participants!=='string')throw new TaskError('参加対象の入力形式が不正です');
  const dates = eventDates(input.dates);
  const occurrence = validateOccurrences(input.occurrence_type, dates);
  const times = parseEventTimes(input.event_times === undefined ? {} : input.event_times, dates);
  validateLecturerRole(input.lecturer_role);
  validateFees(input);
  const methods=parseSessionMethods(input.session_delivery_methods===undefined?{}:input.session_delivery_methods,dates);
  const repeatFees=parseRepeatFees(input.repeat_fees===undefined?emptyRepeatFees():input.repeat_fees);
  const audience=input.audience_roles===undefined?(input.target_participants?.trim()?null:allAudienceRoles()):parseAudienceRoles(input.audience_roles);
  const speakers=input.speakers===undefined?null:resolveSpeakers(db,input.speakers,[],actorId);
  const guest=speakers?.find(p=>p.role==='EXTERNAL_LECTURER');
  const external=speakers!==null?(guest?{status:'YES' as const,id:guest.id,name:guest.name,facility:guest.facility}:{...emptyExternal(),status:'NO' as const}):input.external_lecturer===undefined?emptyExternal():resolveExternalSelection(db,input.external_lecturer);
  const stmt = db.prepare(`
    INSERT INTO seminars (
      speakers, event_type, delivery_method, social_gathering, name, dates, content, lecturer_name, assistant_members,
      fee_dental_hygienist, fee_dentist, fee_other, target_participants, audience_roles,
      venue, venue_id, venue_fee, sns_announcement, occurrence_type, event_times, lecturer_role, session_delivery_methods, repeat_fees, external_lecturer, external_payment,
      lecturer_invitation_sent, photo_received, abstract_300_requested,
      abstract_800_requested, receipt_issued, notes
    ) VALUES (
      @speakers, @event_type, @delivery_method, @social_gathering, @name, @dates, @content, @lecturer_name, @assistant_members,
      @fee_dental_hygienist, @fee_dentist, @fee_other, @target_participants, @audience_roles,
      @venue, @venue_id, @venue_fee, @sns_announcement, @occurrence_type, @event_times, @lecturer_role, @session_delivery_methods, @repeat_fees, @external_lecturer, @external_payment,
      @lecturer_invitation_sent, @photo_received, @abstract_300_requested,
      @abstract_800_requested, @receipt_issued, @notes
    )
  `);
  const result = stmt.run({
    ...input,
    speakers:speakers===null?null:JSON.stringify(speakers),
    audience_roles:audience===null?null:JSON.stringify(audience),
    target_participants:audience===null?input.target_participants:audienceText(audience),
    session_delivery_methods: JSON.stringify(methods),
    repeat_fees: JSON.stringify(repeatFees),
    external_lecturer:JSON.stringify(external),
    external_payment:JSON.stringify(speakers===null?(input.external_payment===undefined?emptyExternalPayment():parseExternalPayment(input.external_payment)):speakerPaymentTotal(speakers)),
    occurrence_type: occurrence,
    event_times: JSON.stringify(times),
    lecturer_role: input.lecturer_role ?? null,
    delivery_method: input.delivery_method ?? null,
    venue_id: validateVenueLink(db, input.venue_id === undefined ? null : input.venue_id),
    social_gathering: JSON.stringify(resolveSocialAttendance(db,parseSocialGathering(input.social_gathering === undefined ? emptySocialGathering() : input.social_gathering),external)),
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

export function updateSeminar(id: number, input: Partial<SeminarInput>, actorId?:number): Seminar | null {
  const db = getDb();
  const current = getSeminarById(id);
  if (!current) return null;

  const merged = { ...current, ...input };
  if(input.target_participants!==undefined&&typeof input.target_participants!=='string')throw new TaskError('参加対象の入力形式が不正です');
  const dates = eventDates(merged.dates);
  if (input.occurrence_type !== undefined || input.dates !== undefined) validateOccurrences(merged.occurrence_type, dates);
  validateLecturerRole(merged.lecturer_role);
  validateFees(merged);
  const methods=input.session_delivery_methods===undefined?current.session_delivery_methods:{
    ...Object.fromEntries(Object.entries(current.session_delivery_methods).filter(([date])=>!dates.includes(date))),
    ...parseSessionMethods(input.session_delivery_methods,dates),
  };
  const repeatFees=input.repeat_fees===undefined?current.repeat_fees:parseRepeatFees(input.repeat_fees);
  const speakers=input.speakers===undefined?(current.speakers==null?current.speakers:eventSpeakers(current)):resolveSpeakers(db,input.speakers,eventSpeakers(current),actorId);
  const guest=speakers?.find(p=>p.role==='EXTERNAL_LECTURER');
  const external=input.speakers!==undefined?(guest?{status:'YES' as const,id:guest.id,name:guest.name,facility:guest.facility}:{...emptyExternal(),status:'NO' as const}):input.external_lecturer===undefined?current.external_lecturer:resolveExternalSelection(db,input.external_lecturer,current.external_lecturer.status==='UNDECIDED'&&current.lecturer_role==='EXTERNAL_LECTURER'&&current.lecturer_name?{status:'YES',id:null,name:current.lecturer_name,facility:''}:current.external_lecturer);
  const times = input.event_times === undefined ? current.event_times : {
    ...Object.fromEntries(Object.entries(current.event_times).filter(([date]) => !dates.includes(date))),
    ...parseEventTimes(input.event_times, dates),
  };
  db.prepare(`
    UPDATE seminars SET
      speakers=@speakers,
      event_type = @event_type, delivery_method = @delivery_method, social_gathering = @social_gathering, name = @name, dates = @dates, content = @content,
      lecturer_name = @lecturer_name, assistant_members = @assistant_members,
      fee_dental_hygienist = @fee_dental_hygienist, fee_dentist = @fee_dentist,
      fee_other = @fee_other, target_participants = @target_participants, audience_roles = @audience_roles,
      venue = @venue, venue_id = @venue_id, venue_fee = @venue_fee, sns_announcement = @sns_announcement,
      lecturer_invitation_sent = @lecturer_invitation_sent, photo_received = @photo_received,
      abstract_300_requested = @abstract_300_requested, abstract_800_requested = @abstract_800_requested,
      receipt_issued = @receipt_issued, notes = @notes, occurrence_type=@occurrence_type, event_times=@event_times, lecturer_role=@lecturer_role, session_delivery_methods=@session_delivery_methods, repeat_fees=@repeat_fees, external_lecturer=@external_lecturer, external_payment=@external_payment
    WHERE id = @id
  `).run({
    id,
    speakers:speakers==null?null:JSON.stringify(speakers),
    session_delivery_methods: JSON.stringify(methods),
    repeat_fees: JSON.stringify(repeatFees),
    external_lecturer:JSON.stringify(external),
    external_payment:JSON.stringify(speakers==null?(input.external_payment===undefined?current.external_payment:parseExternalPayment(input.external_payment)):speakerPaymentTotal(eventSpeakers({...current,speakers}))),
    occurrence_type: merged.occurrence_type,
    event_times: JSON.stringify(times),
    lecturer_role: merged.lecturer_role,
    event_type: merged.event_type,
    delivery_method: merged.delivery_method,
    social_gathering: JSON.stringify(input.social_gathering === undefined ? current.social_gathering : resolveSocialAttendance(db,mergeSocialGathering(current.social_gathering, input.social_gathering),external,current.social_gathering)),
    name: merged.name,
    dates: JSON.stringify(merged.dates),
    content: merged.content,
    lecturer_name: merged.lecturer_name,
    assistant_members: JSON.stringify(merged.assistant_members),
    fee_dental_hygienist: merged.fee_dental_hygienist,
    fee_dentist: merged.fee_dentist,
    fee_other: merged.fee_other,
    audience_roles:input.audience_roles!==undefined?JSON.stringify(parseAudienceRoles(input.audience_roles)):input.target_participants!==undefined?null:current.audience_roles===null?null:JSON.stringify(current.audience_roles),
    target_participants:input.audience_roles!==undefined?audienceText(parseAudienceRoles(input.audience_roles)):merged.target_participants,
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

function validateFees(input: Pick<SeminarInput,'fee_dental_hygienist'|'fee_dentist'|'fee_other'>) {
  for(const fee of [input.fee_dental_hygienist,input.fee_dentist,input.fee_other]) if(!Number.isSafeInteger(fee)||fee<0) throw new TaskError('参加費は0円以上の整数で入力してください');
}

function validateLecturerRole(value: unknown) {
  if (value != null && !['EXTERNAL_LECTURER', 'SOCIETY_LECTURER'].includes(value as string)) throw new TaskError('講師区分が不正です');
}

// ─── Participant ─────────────────────────────────────────────────────────────

export type { Participant, ParticipantRole, PaymentStatus };

type ParticipantRow = Omit<Participant, 'attended'> & { attended: number };

function rowToParticipant(row: ParticipantRow): Participant {
  return { ...row, attended: Boolean(row.attended) };
}

export function getParticipantsBySeminar(seminarId: number): Participant[] {
  const db = getDb();
  const rows = db
    .prepare('SELECT p.*,r.id AS issued_receipt_id,r.issued_at AS receipt_issued_at FROM participants p LEFT JOIN participant_receipts r ON r.participant_id=p.id WHERE p.seminar_id = ? ORDER BY p.created_at ASC')
    .all(seminarId) as ParticipantRow[];
  return rows.map(rowToParticipant);
}

export function getParticipantById(id: number): Participant | null {
  const db = getDb();
  const row = db.prepare('SELECT p.*,r.id AS issued_receipt_id,r.issued_at AS receipt_issued_at FROM participants p LEFT JOIN participant_receipts r ON r.participant_id=p.id WHERE p.id = ?').get(id) as ParticipantRow | undefined;
  return row ? rowToParticipant(row) : null;
}

export type ParticipantInput = ParticipantFields & { seminar_id: number };

export function createParticipant(input: ParticipantInput, actorId: number | null = null): Participant {
  const db = getDb();
  return db.transaction(() => {
    const { seminar_id, ...fields } = input;
    const data = parseParticipant(fields);
    const confirmation = paymentConfirmation(db, data, null, actorId);
    const result = db.prepare(`INSERT INTO participants(seminar_id,name,role,email,phone,payment_status,payment_method,paid_amount,payment_confirmed_at,payment_confirmed_by,attended,receipt_number,notes)
      VALUES(@seminar_id,@name,@role,@email,@phone,@payment_status,@payment_method,@paid_amount,@payment_confirmed_at,@payment_confirmed_by,@attended,@receipt_number,@notes)`)
      .run({ ...data, ...confirmation, seminar_id, attended: data.attended ? 1 : 0 });
    const created = getParticipantById(Number(result.lastInsertRowid))!;
    paymentHistory(db, created, null, actorId);
    return created;
  }).immediate();
}

export function updateParticipant(id: number, input: Partial<ParticipantFields>, actorId: number | null = null): Participant | null {
  const db = getDb();
  return db.transaction(() => {
    const current = getParticipantById(id);
    if (!current) return null;
    const merged = parseParticipant(input, current);
    if (current.issued_receipt_id && (merged.payment_status !== 'paid' || merged.payment_method !== current.payment_method || merged.paid_amount !== current.paid_amount || merged.receipt_number !== current.receipt_number)) throw new TaskError('領収書発行済みの入金情報・領収書番号は変更できません', 409);
    const confirmation = input.payment_status === 'paid' || current.payment_status !== merged.payment_status || ('paid_amount' in input && merged.paid_amount !== current.paid_amount)
      ? paymentConfirmation(db, merged, current, actorId)
      : { payment_confirmed_at: current.payment_confirmed_at, payment_confirmed_by: current.payment_confirmed_by };
    db.prepare(`
      UPDATE participants SET
        name = @name, role = @role, email = @email, phone = @phone,
        payment_status = @payment_status, attended = @attended,
        receipt_number = @receipt_number, notes = @notes, payment_method=@payment_method, paid_amount=@paid_amount,
        payment_confirmed_at=@payment_confirmed_at,payment_confirmed_by=@payment_confirmed_by
      WHERE id = @id
    `).run({ ...merged, ...confirmation, id, attended: merged.attended ? 1 : 0 });
    const updated = getParticipantById(id)!;
    paymentHistory(db, updated, current, actorId);
    return updated;
  }).immediate();
}

function paymentConfirmation(db: Database.Database, input: ParticipantFields, current: Participant | null, actorId: number | null) {
  if (input.payment_status === 'unpaid') return { payment_confirmed_at: null, payment_confirmed_by: null };
  if (input.paid_amount === null) throw new TaskError('入金を確認した金額を入力してください');
  if (!actorId || !db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId)) throw new TaskError('入金確認には有効な運営メンバーのログインが必要です', 403);
  return { payment_confirmed_at: current?.payment_confirmed_at ?? new Date().toISOString(), payment_confirmed_by: current?.payment_confirmed_by ?? actorId };
}
function paymentHistory(db: Database.Database, after: Participant, before: Participant | null, actorId: number | null) {
  const snapshot = (p: Participant) => ({ payment_status: p.payment_status, payment_method: p.payment_method, paid_amount: p.paid_amount, payment_confirmed_at: p.payment_confirmed_at });
  const next = JSON.stringify(snapshot(after)), previous = before ? JSON.stringify(snapshot(before)) : null;
  if (next !== previous) db.prepare('INSERT INTO participant_payment_history(seminar_id,participant_id,actor_id,before_json,after_json) VALUES(?,?,?,?,?)').run(after.seminar_id, after.id, actorId, previous, next);
}

export function deleteParticipant(id: number): boolean {
  const db = getDb();
  const result = db.prepare('DELETE FROM participants WHERE id = ?').run(id);
  return result.changes > 0;
}
