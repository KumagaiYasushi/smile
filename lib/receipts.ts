import type Database from 'better-sqlite3';
import { TaskError, todayInTokyo } from '../types/task.ts';
import { canIssueReceipt } from '../types/participant.ts';
import type { ParticipantRole } from '../types/participant.ts';

export type IssuedReceipt = {
  id: number; seminar_id: number; participant_id: number; receipt_number: string;
  participant_name: string; participant_role: ParticipantRole; event_name: string; event_dates: string[];
  venue: string; lecturer_name: string; amount: number; issue_date: string; actor_id: number; issued_at: string;
};
export function initReceiptSchema(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS participant_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
    participant_id INTEGER NOT NULL UNIQUE REFERENCES participants(id) ON DELETE CASCADE,
    receipt_number TEXT NOT NULL UNIQUE, participant_name TEXT NOT NULL, participant_role TEXT NOT NULL,
    event_name TEXT NOT NULL, event_dates_json TEXT NOT NULL, venue TEXT NOT NULL, lecturer_name TEXT NOT NULL,
    amount INTEGER NOT NULL CHECK(amount>=0), issue_date TEXT NOT NULL, actor_id INTEGER NOT NULL,
    issued_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS participant_payment_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,
      participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE, actor_id INTEGER,
      before_json TEXT, after_json TEXT NOT NULL, occurred_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);
}
export function createReceiptStore(db: Database.Database) {
  initReceiptSchema(db);
  function get(seminarId: number, participantId: number) {
    const row = db.prepare('SELECT * FROM participant_receipts WHERE seminar_id=? AND participant_id=?').get(seminarId, participantId) as (Omit<IssuedReceipt, 'event_dates'> & { event_dates_json: string }) | undefined;
    if (!row) throw new TaskError('領収書はまだ発行されていません。入金確認後に発行してください', 404);
    const { event_dates_json, ...receipt } = row;
    return { ...receipt, event_dates: JSON.parse(event_dates_json) as string[] };
  }
  return {
    get,
    issue(seminarId: number, participantId: number, actorId: number) {
      return db.transaction(() => {
        if (!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId)) throw new TaskError('有効な運営メンバーとしてログインしてください', 403);
        const participant = db.prepare('SELECT * FROM participants WHERE seminar_id=? AND id=?').get(seminarId, participantId) as {
          name: string; receipt_name?:string; role: ParticipantRole; payment_status: 'unpaid' | 'paid'; payment_method: 'bank_transfer' | null;
          paid_amount: number | null; payment_confirmed_at: string | null; receipt_number: string;
        } | undefined;
        if (!participant) throw new TaskError('参加者が見つかりません', 404);
        if (!canIssueReceipt(participant)) throw new TaskError('銀行振込の入金額と入金確認を登録してから領収書を発行してください', 409);
        if (db.prepare('SELECT id FROM participant_receipts WHERE participant_id=?').get(participantId)) return { receipt: get(seminarId, participantId), reused: true };
        const event = db.prepare('SELECT name,dates,venue,lecturer_name FROM seminars WHERE id=?').get(seminarId) as { name: string; dates: string; venue: string; lecturer_name: string };
        const number = participant.receipt_number || `SMILE-${seminarId}-${participantId}`;
        if (db.prepare('SELECT id FROM participant_receipts WHERE receipt_number=?').get(number)) throw new TaskError('領収書番号が他の参加者と重複しています', 409);
        db.prepare(`INSERT INTO participant_receipts(seminar_id,participant_id,receipt_number,participant_name,participant_role,event_name,event_dates_json,venue,lecturer_name,amount,issue_date,actor_id)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(seminarId, participantId, number, participant.receipt_name?.trim()||participant.name, participant.role, event.name, event.dates, event.venue, event.lecturer_name, participant.paid_amount, todayInTokyo(), actorId);
        db.prepare('UPDATE participants SET receipt_number=? WHERE id=?').run(number, participantId);
        return { receipt: get(seminarId, participantId), reused: false };
      }).immediate();
    },
  };
}
