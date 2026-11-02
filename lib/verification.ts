import type Database from 'better-sqlite3';
import { createSeminar, createParticipant } from './db.ts';
import { createVenueStore } from './venues.ts';
import { createStaffAttendanceStore } from './staff-attendance.ts';
import { createLunchStore } from './lunch.ts';
import { createTaskStore } from './tasks.ts';
import { createTemplateStore } from './task-templates.ts';
import { emptySocialGathering } from '../types/social-gathering.ts';
import type { EventType, DeliveryMethod } from '../types/seminar.ts';

export function seedVerification(db: Database.Database, actorId: number): number[] {
  if (process.env.SMILE_VERIFICATION_MODE !== '1') throw new Error('検証専用環境でのみ初期化できます');
  db.exec('CREATE TABLE IF NOT EXISTS verification_samples(version INTEGER PRIMARY KEY,event_ids_json TEXT NOT NULL)');
  const venues = createVenueStore(db), staff = createStaffAttendanceStore(db), lunch = createLunchStore(db);
  const tasks = createTaskStore(db), templates = createTemplateStore(db);
  return db.transaction(() => {
    const existing = db.prepare('SELECT event_ids_json FROM verification_samples WHERE version=1').get() as { event_ids_json: string } | undefined;
    if (existing) return JSON.parse(existing.event_ids_json) as number[];
    const venue = venues.create({ name: '【架空】検証用会議室', room: 'テストルームA', address: '架空県テスト市 サンプルビル',
      contact_person: '検証用窓口', email: 'venue@example.invalid', capacity: 30, reference_fee: 10000, fee_unit: '半日', equipment: 'プロジェクター・ホワイトボード' }, actorId);
    const examples: { type: EventType; method: DeliveryMethod; name: string; dates: string[] }[] = [
      { type: 'BASIC_COURSE', method: 'HYBRID', name: '【検証】ベーシックコース', dates: ['2027-06-01', '2027-06-08'] },
      { type: 'LECTURE', method: 'ONSITE', name: '【検証】講演会', dates: ['2027-06-15'] },
      { type: 'SEMINAR', method: 'ONLINE', name: '【検証】セミナー', dates: ['2027-06-22'] },
    ];
    const ids: number[] = [];
    for (const example of examples) {
      templates.createTemplate({ event_type: example.type, title: '【検証】開催前の準備確認', relative_days: -7, important: true }, actorId);
      const event = templates.createEvent(() => createSeminar({ event_type: example.type, delivery_method: example.method, name: example.name,
        dates: example.dates, content: '架空データです。編集・保存・日程変更などを試してください。', lecturer_name: '【架空】講師A', assistant_members: ['【架空】サポートA'],
        fee_dental_hygienist: 5000, fee_dentist: 8000, fee_other: 5000, target_participants: '検証用の参加者',
        venue_id: venue.id, venue: '【架空】検証用会議室 / テストルームA / 架空県テスト市 サンプルビル', venue_fee: 15000,
        sns_announcement: '', lecturer_invitation_sent: false, photo_received: false, abstract_300_requested: false, abstract_800_requested: false,
        receipt_issued: false, notes: '実際の申込・注文・外部送信は発生しません。',
        social_gathering: example.method === 'ONLINE' ? emptySocialGathering() : { status: 'HELD', start_at: `${example.dates[0]}T18:30`,
          end_at: `${example.dates[0]}T20:30`, venue: '【架空】サンプルレストラン', fee: 5000 },
      }), actorId, true, example.dates[0]);
      ids.push(event.id);
      staff.importNames(event.id, { schedule: example.dates }, actorId);
      staff.create(event.id, { name: '【架空】外来講師B', role: 'LECTURER', schedule: example.dates,
        responses: Object.fromEntries(example.dates.map(date => [date, 'TENTATIVE'])) }, actorId);
      for (const target of ['LECTURER', 'EXTERNAL_LECTURER', 'SUPPORT'] as const) lunch.create(event.id, {
        target, date: example.dates[0], schedule: example.dates, quantity: 1, unit_price: 1200, additional_cost: 0,
        shop_name: '【架空】検証用弁当店', menu: 'サンプル弁当', status: 'PLANNED',
      }, actorId);
      tasks.createTask(event.id, { title: '【検証】会場・昼食の確認', due_date: example.dates[0], assignee_id: actorId, important: true }, actorId);
      createParticipant({ seminar_id: event.id, name: '【架空】参加者A', role: 'dentist', email: 'participant@example.invalid', phone: '',
        payment_status: 'unpaid', attended: false, receipt_number: 'TEST-001', notes: '画面確認用の架空データ' });
    }
    db.prepare('INSERT INTO verification_samples(version,event_ids_json) VALUES(1,?)').run(JSON.stringify(ids));
    return ids;
  }).immediate();
}
