import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { isEventType, isDeliveryMethod, deliveryMethodLabel } from '../types/seminar.ts';
import { eventAttendanceText } from '../lib/event-presentation.ts';

const dbModule = new URL('../lib/db.ts', import.meta.url).href;
const sqliteModule = new URL('../node_modules/better-sqlite3/lib/index.js', import.meta.url).href;

function inTemporaryDatabase(script) {
  const directory = mkdtempSync(join(tmpdir(), 'smile-event-types-'));
  try {
    execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      import Database from ${JSON.stringify(sqliteModule)};
      import { mkdirSync } from 'node:fs';
      ${script}
    `], { cwd: directory, stdio: 'pipe' });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test('only the three specified event types are accepted', () => {
  for (const value of ['BASIC_COURSE', 'LECTURE', 'SEMINAR']) assert.ok(isEventType(value));
  for (const value of [undefined, null, '', 'lecture', 'OTHER', 'toString', '__proto__', 1, {}]) {
    assert.equal(isEventType(value), false);
  }
});

test('fresh database stores every type and preserves it during unrelated edits and restart', () => {
  inTemporaryDatabase(`
    const { getDb, createSeminar, updateSeminar, getSeminarById } = await import(${JSON.stringify(dbModule)});
    const input = {
      occurrence_type: 'SINGLE', event_times: {}, lecturer_role: null, name: '架空イベント', dates: ['2027-01-01'], content: '', lecturer_name: '', assistant_members: [],
      fee_dental_hygienist: 0, fee_dentist: 0, fee_other: 0, target_participants: '', venue: '',
      venue_fee: 0, sns_announcement: '', lecturer_invitation_sent: false, photo_received: false,
      abstract_300_requested: false, abstract_800_requested: false, receipt_issued: false, notes: '',
    };
    for (const event_type of ['BASIC_COURSE', 'LECTURE', 'SEMINAR']) {
      const created = createSeminar({ ...input, event_type });
      assert.equal(created.delivery_method, null);
      assert.equal(getSeminarById(created.id).event_type, event_type);
      assert.equal(updateSeminar(created.id, { venue: '架空会場' }).event_type, event_type);
      assert.equal(updateSeminar(created.id, { event_type: 'LECTURE' }).event_type, 'LECTURE');
      for (const delivery_method of ['ONSITE', 'ONLINE', 'HYBRID']) {
        assert.equal(updateSeminar(created.id, { delivery_method }).delivery_method, delivery_method);
        assert.equal(updateSeminar(created.id, { venue: '配信拠点', venue_fee: 1000 }).delivery_method, delivery_method);
      }
      assert.equal(getSeminarById(created.id).venue, '配信拠点');
      assert.equal(getSeminarById(created.id).venue_fee, 1000);
    }
    assert.throws(() => createSeminar({ ...input, event_type: 'OTHER' }), /CHECK constraint/);
    assert.throws(() => updateSeminar(1, { event_type: null }), /NOT NULL/);
    assert.throws(() => updateSeminar(1, { delivery_method: 'OTHER' }), /CHECK constraint/);
    getDb().close();
    const reopened = new Database('data/seminars.db');
    assert.equal(reopened.prepare('SELECT count(*) n FROM seminars').get().n, 3);
    assert.ok(reopened.prepare('SELECT event_type FROM seminars').all().every(r => r.event_type === 'LECTURE'));
    assert.ok(reopened.prepare('SELECT delivery_method FROM seminars').all().every(r => r.delivery_method === 'HYBRID'));
    reopened.close();
  `);
});

test('legacy database migrates without losing IDs, dates, timestamps, checklist or participants; migration is repeatable', () => {
  inTemporaryDatabase(`
    mkdirSync('data');
    const legacy = new Database('data/seminars.db');
    legacy.exec(\`
      CREATE TABLE seminars (
        id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        dates TEXT NOT NULL DEFAULT '[]', content TEXT DEFAULT '', lecturer_name TEXT DEFAULT '',
        assistant_members TEXT NOT NULL DEFAULT '[]', fee_dental_hygienist INTEGER DEFAULT 0,
        fee_dentist INTEGER DEFAULT 0, fee_other INTEGER DEFAULT 0, target_participants TEXT DEFAULT '',
        venue TEXT DEFAULT '', venue_fee INTEGER DEFAULT 0, sns_announcement TEXT DEFAULT '',
        lecturer_invitation_sent INTEGER DEFAULT 0, photo_received INTEGER DEFAULT 0,
        abstract_300_requested INTEGER DEFAULT 0, abstract_800_requested INTEGER DEFAULT 0,
        receipt_issued INTEGER DEFAULT 0, notes TEXT DEFAULT '', created_at TEXT, updated_at TEXT
      );
      INSERT INTO seminars (id, name, dates, photo_received, created_at, updated_at)
      VALUES (42, '架空の既存セミナー', '["2027-01-01"]', 1, '2026-01-01', '2026-02-01');
      CREATE TABLE participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT, seminar_id INTEGER NOT NULL REFERENCES seminars(id),
        name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'other', email TEXT DEFAULT '', phone TEXT DEFAULT '',
        payment_status TEXT NOT NULL DEFAULT 'unpaid', attended INTEGER DEFAULT 0,
        receipt_number TEXT DEFAULT '', notes TEXT DEFAULT '', created_at TEXT, updated_at TEXT
      );
      INSERT INTO participants (id, seminar_id, name, payment_status, attended)
      VALUES (7, 42, '架空の既存参加者', 'paid', 1);
    \`);
    legacy.close();
    const first = await import(${JSON.stringify(dbModule)});
    assert.deepEqual(first.getSeminarById(42).dates, ['2027-01-01']);
    assert.equal(first.getSeminarById(42).event_type, 'SEMINAR');
    assert.equal(first.getSeminarById(42).delivery_method, null);
    assert.equal(first.getSeminarById(42).venue_id, null);
    assert.equal(first.getSeminarById(42).occurrence_type, null);
    assert.deepEqual(first.getSeminarById(42).event_times, {});
    assert.equal(first.getSeminarById(42).lecturer_role, null);
    assert.equal(first.getSeminarById(42).audience_roles,null);
    assert.deepEqual(first.getSeminarById(42).external_lecturer, {status:'UNDECIDED',id:null,name:'',facility:''});
    assert.deepEqual(first.getSeminarById(42).social_gathering, { status: 'UNDECIDED', start_at: null, end_at: null, venue: '', fee: null });
    assert.equal(first.getSeminarById(42).photo_received, true);
    assert.equal(first.getSeminarById(42).created_at, '2026-01-01');
    assert.equal(first.getSeminarById(42).updated_at, '2026-02-01');
    assert.equal(first.getParticipantsBySeminar(42)[0].id, 7);
    assert.equal(first.getParticipantsBySeminar(42)[0].payment_status, 'paid');
    assert.equal(first.getParticipantsBySeminar(42)[0].payment_method, null);
    assert.equal(first.getParticipantsBySeminar(42)[0].paid_amount, null);
    assert.equal(first.getParticipantsBySeminar(42)[0].payment_confirmed_at, null);
    assert.equal(first.getParticipantsBySeminar(42)[0].issued_receipt_id, null);
    assert.equal(first.getParticipantsBySeminar(42)[0].attended, true);
    const participant = first.createParticipant({ seminar_id: 42, name: '架空参加者', role: 'other',
      email: '', phone: '', payment_status: 'unpaid', attended: false, receipt_number: '', notes: '' });
    first.getDb().close();
    const second = await import(${JSON.stringify(dbModule + '?restart')});
    assert.equal(second.getSeminarById(42).event_type, 'SEMINAR');
    assert.equal(second.getSeminarById(42).delivery_method, null);
    assert.equal(second.getSeminarById(42).venue_id, null);
    assert.deepEqual(second.getSeminarById(42).external_lecturer, {status:'UNDECIDED',id:null,name:'',facility:''});
    assert.equal(second.getDb().prepare('PRAGMA table_info(seminars)').all().filter(c => c.name === 'venue_id').length, 1);
    assert.equal(second.getSeminarById(42).social_gathering.status, 'UNDECIDED');
    assert.equal(second.getDb().prepare('PRAGMA table_info(seminars)').all().filter(c => c.name === 'social_gathering').length, 1);
    assert.equal(second.getDb().prepare('PRAGMA table_info(seminars)').all().filter(c => c.name === 'delivery_method').length, 1);
    assert.deepEqual(second.getParticipantsBySeminar(42).map(p => p.id), [7, participant.id]);
    assert.equal(second.getDb().prepare('PRAGMA table_info(seminars)').all().filter(c => c.name === 'event_type').length, 1);
    second.getDb().close();
  `);
});

test('delivery methods have the three exact labels; online announcements omit internal venues', () => {
  const labels = { ONSITE: '現地開催', ONLINE: 'オンライン', HYBRID: '現地開催＋オンライン' };
  for (const [method, label] of Object.entries(labels)) {
    assert.ok(isDeliveryMethod(method));
    assert.equal(deliveryMethodLabel(method), label);
    const text = eventAttendanceText({ delivery_method: method, venue: '内部会場' });
    assert.ok(text.includes(label));
    assert.equal(text.includes('内部会場'), method !== 'ONLINE');
    assert.equal(text.includes('■ 会場'), method !== 'ONLINE');
  }
  for (const value of [undefined, null, '', 'online', 'OTHER', 'toString', '__proto__', 1, {}]) assert.equal(isDeliveryMethod(value), false);
  assert.equal(deliveryMethodLabel(null), '未設定');
  assert.match(eventAttendanceText({ delivery_method: null, venue: '' }), /未設定/);
});
