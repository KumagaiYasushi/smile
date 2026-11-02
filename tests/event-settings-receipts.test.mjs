import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eventDates, validateOccurrences, parseEventTimes, formatEventDate } from '../types/event-schedule.ts';
import { parseSessionMethods,parseRepeatFees,eventDeliveryLabel } from '../types/event-options.ts';
import { eventAttendanceText,eventFeeText } from '../lib/event-presentation.ts';
import { parseParticipant, canIssueReceipt } from '../types/participant.ts';

const moduleUrl = name => new URL(`../lib/${name}.ts`, import.meta.url).href;
function inDatabase(script) {
  const directory = mkdtempSync(join(tmpdir(), 'smile-settings-receipts-'));
  try {
    execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import assert from 'node:assert/strict';
      const { getDb, createSeminar, getSeminarById, updateSeminar, createParticipant, getParticipantById, updateParticipant } = await import(${JSON.stringify(moduleUrl('db'))});
      const { createReceiptStore } = await import(${JSON.stringify(moduleUrl('receipts'))});
      const { createRescheduleStore } = await import(${JSON.stringify(moduleUrl('reschedule'))});
      const eventInput = { event_type:'SEMINAR', occurrence_type:'SINGLE', name:'架空イベント', dates:['2027-01-01'], content:'', lecturer_name:'講師', assistant_members:[], fee_dental_hygienist:10000,fee_dentist:20000,fee_other:0,target_participants:'',venue:'会場',venue_fee:0,sns_announcement:'',lecturer_invitation_sent:false,photo_received:false,abstract_300_requested:false,abstract_800_requested:false,receipt_issued:false,notes:'' };
      const pInput = { name:'架空参加者',role:'dentist',email:'',phone:'',payment_status:'unpaid',payment_method:'bank_transfer',paid_amount:null,attended:false,receipt_number:'',notes:'' };
      const db=getDb();
      db.exec('CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER NOT NULL); INSERT INTO auth_users VALUES(1,1),(2,0)');
      ${script}
      db.close();
    `], { cwd: directory, env: { ...process.env, SMILE_DATA_DIR: directory }, stdio: 'pipe' });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test('occurrence choice is explicit; dates are real and unique; single events never accept two days', () => {
  for (const invalid of [undefined, null, '', 'toString', '__proto__', 'single', 1]) assert.throws(() => validateOccurrences(invalid, []));
  assert.equal(validateOccurrences('SINGLE', []), 'SINGLE');
  assert.equal(validateOccurrences('MULTIPLE', ['2027-01-01']), 'MULTIPLE');
  assert.throws(() => validateOccurrences('SINGLE', ['2027-01-01','2027-02-01']));
  for (const invalid of [['2027-02-29'], ['2027-01-01','2027-01-01'], ['2027-01-01T10:00'], '2027-01-01']) assert.throws(() => eventDates(invalid));
  assert.deepEqual(eventDates(['2028-02-29']), ['2028-02-29']);
});

test('event date display defaults to date only and accepts optional validated Japan times', () => {
  const dates=['2027-01-01'];
  assert.equal(formatEventDate(dates[0]), '2027年1月1日');
  const times=parseEventTimes({[dates[0]]:{start:'09:00',end:'17:30'}},dates);
  assert.equal(formatEventDate(dates[0], times), '2027年1月1日 09:00〜17:30（日本時間）');
  assert.deepEqual(parseEventTimes({[dates[0]]:{start:'09:00'}},dates), {[dates[0]]:{start:'09:00',end:null}});
  for(const input of [null, [], {'2027-02-01':{start:'09:00'}}, {[dates[0]]:{start:'24:00'}}, {[dates[0]]:{start:'12:00',end:'11:00'}}, {[dates[0]]:{start:'9:00'}}, {[dates[0]]:{start:'09:00',hidden:true}}]) assert.throws(()=>parseEventTimes(input,dates));
});

test('all event types require occurrence; time edits and rescheduling preserve other settings and old times', () => inDatabase(`
  for(const event_type of ['BASIC_COURSE','LECTURE','SEMINAR']) {
    assert.throws(()=>createSeminar({...eventInput,event_type,occurrence_type:undefined}), /開催回数/);
    assert.throws(()=>createSeminar({...eventInput,event_type,dates:['2027-01-01','2027-01-02']}),/単回/);
    const event=createSeminar({...eventInput,event_type,event_times:{'2027-01-01':{start:'09:00',end:null}}});
    assert.equal(event.lecturer_role,null);
    assert.deepEqual(updateSeminar(event.id,{notes:'維持'}).event_times,event.event_times);
    const schedules=createRescheduleStore(db);
    assert.throws(()=>schedules.preview(event.id,{dates:['2027-01-01','2027-02-01'],base_date:null}),/単回/);
    const preview=schedules.preview(event.id,{dates:['2027-02-01'],base_date:'2027-02-01'});
    updateSeminar(event.id,{occurrence_type:'MULTIPLE'});
    assert.throws(()=>schedules.apply(event.id,{dates:preview.new_dates,base_date:preview.base_date,preview_token:preview.preview_token,decisions:[]},1,dates=>updateSeminar(event.id,{dates})),/プレビュー/);
    updateSeminar(event.id,{dates:['2027-02-01'],event_times:{'2027-02-01':{start:'10:00',end:'11:00'}}});
    assert.equal(getSeminarById(event.id).event_times['2027-01-01'].start,'09:00');
    const cleared=updateSeminar(event.id,{event_times:{}});
    assert.equal(cleared.event_times['2027-02-01'],undefined);
    assert.equal(cleared.event_times['2027-01-01'].start,'09:00');
    assert.equal(db.prepare('SELECT count(*) n FROM participant_receipts').get().n,0);
  }
`));

test('participant validation rejects forged confirmation, bad amounts and types without copying server fields', () => {
  const p=parseParticipant({name:' A ',payment_method:'bank_transfer'});
  assert.equal(p.name,'A');
  assert.equal(canIssueReceipt({...p,payment_confirmed_at:null}),false);
  assert.equal(canIssueReceipt({payment_status:'paid',payment_method:'bank_transfer'}),false);
  const edited=parseParticipant({notes:'new'},{...p,id:1,payment_confirmed_at:'forged'});
  assert.equal('id' in edited,false);
  for(const input of [{payment_confirmed_at:'forged'},{payment_confirmed_by:1},{seminar_id:1},{issued_receipt_id:1},{paid_amount:-1},{paid_amount:1.5},{paid_amount:'100'},{attended:1},{payment_method:'toString'},{payment_status:null}]) assert.throws(()=>parseParticipant({name:'A',...input}));
});

test('only confirmed bank transfers issue immutable receipts for the actual amount; retries and scope are safe', () => inDatabase(`
  const event=createSeminar(eventInput), second=createSeminar({...eventInput,name:'別イベント'});
  const participant=createParticipant({...pInput,seminar_id:event.id},1), receipts=createReceiptStore(db);
  assert.throws(()=>receipts.get(event.id,participant.id),/まだ発行/);
  assert.throws(()=>receipts.issue(event.id,participant.id,1),/入金額と入金確認/);
  assert.throws(()=>updateParticipant(participant.id,{payment_status:'paid'},1),/金額/);
  assert.throws(()=>updateParticipant(participant.id,{payment_status:'paid',paid_amount:8800},2),/ログイン/);
  const confirmed=updateParticipant(participant.id,{payment_status:'paid',paid_amount:8800},1);
  assert.ok(confirmed.payment_confirmed_at); assert.equal(confirmed.payment_confirmed_by,1);
  assert.throws(()=>receipts.issue(second.id,participant.id,1),/見つかりません/);
  assert.throws(()=>receipts.issue(event.id,participant.id,2),/ログイン/);
  const issued=receipts.issue(event.id,participant.id,1);
  assert.equal(issued.reused,false); assert.equal(issued.receipt.amount,8800);
  assert.ok(issued.receipt.receipt_number); assert.equal(issued.receipt.actor_id,1);
  assert.equal(getParticipantById(participant.id).issued_receipt_id,issued.receipt.id);
  updateSeminar(event.id,{name:'新しい名前',fee_dentist:99000,venue:'新会場'});
  updateParticipant(participant.id,{name:'改名',notes:'編集'},1);
  assert.deepEqual(receipts.get(event.id,participant.id),issued.receipt);
  assert.equal(receipts.issue(event.id,participant.id,1).reused,true);
  assert.equal(db.prepare('SELECT count(*) n FROM participant_receipts').get().n,1);
  for(const patch of [{payment_status:'unpaid'},{paid_amount:999},{payment_method:'cash'},{receipt_number:'changed'}]) assert.throws(()=>updateParticipant(participant.id,patch,1),/発行済み/);
  assert.equal(db.prepare('SELECT count(*) n FROM participant_payment_history WHERE participant_id=?').get(participant.id).n,2);
`));

test('unknown, cash and legacy paid records cannot issue; payment and receipt failures roll back', () => inDatabase(`
  const event=createSeminar(eventInput),receipts=createReceiptStore(db);
  for(const payment_method of [null,'cash','other']) {
    const p=createParticipant({...pInput,seminar_id:event.id,payment_method,payment_status:'paid',paid_amount:5000},1);
    assert.throws(()=>receipts.issue(event.id,p.id,1),/銀行振込/);
  }
  const p=createParticipant({...pInput,seminar_id:event.id},1);
  db.prepare("UPDATE participants SET payment_status='paid' WHERE id=?").run(p.id);
  assert.throws(()=>receipts.issue(event.id,p.id,1),/入金額と入金確認/);
  assert.equal(updateParticipant(p.id,{notes:'旧データの更新'},1).payment_confirmed_at,null);
  db.exec("CREATE TRIGGER fail_payment BEFORE INSERT ON participant_payment_history BEGIN SELECT RAISE(ABORT,'audit unavailable'); END");
  assert.throws(()=>updateParticipant(p.id,{payment_status:'paid',paid_amount:1234},1),/audit unavailable/);
  assert.equal(getParticipantById(p.id).payment_confirmed_at,null);
  db.exec('DROP TRIGGER fail_payment');
  updateParticipant(p.id,{payment_status:'paid',paid_amount:0},1);
  db.exec("CREATE TRIGGER fail_number BEFORE UPDATE OF receipt_number ON participants BEGIN SELECT RAISE(ABORT,'number unavailable'); END");
  assert.throws(()=>receipts.issue(event.id,p.id,1),/number unavailable/);
  assert.equal(db.prepare('SELECT count(*) n FROM participant_receipts').get().n,0);
  db.exec('DROP TRIGGER fail_number');
  const issued=receipts.issue(event.id,p.id,1); assert.equal(issued.receipt.amount,0);
  const duplicate=createParticipant({...pInput,seminar_id:event.id,payment_status:'paid',paid_amount:100,receipt_number:issued.receipt.receipt_number},1);
  assert.throws(()=>receipts.issue(event.id,duplicate.id,1),/重複/);
  assert.equal(db.prepare('SELECT count(*) n FROM participant_receipts').get().n,1);
`));

test('per-session delivery and repeat fees validate; mixed/online announcements respect actual venues',()=>{
  const dates=['2027-01-01','2027-01-08'];
  for(const value of [null,[],{'2027-01-09':'ONLINE'},{[dates[0]]:'toString'}])assert.throws(()=>parseSessionMethods(value,dates));
  for(const value of [null,[],{dentist:-1},{dentist:1.5},{dentist:'100'},{unknown:1}])assert.throws(()=>parseRepeatFees(value));
  const event={delivery_method:'ONLINE',venue:'会場',dates,session_delivery_methods:parseSessionMethods({[dates[0]]:'ONSITE',[dates[1]]:'ONLINE'},dates),occurrence_type:'MULTIPLE',fee_dental_hygienist:10001,fee_dentist:20001,fee_other:0,repeat_fees:parseRepeatFees({dentist:550,other:0})};
  assert.equal(eventDeliveryLabel(event),'現地開催 ／ オンライン');
  assert.match(eventAttendanceText(event),/2027年1月1日：現地開催/);assert.match(eventAttendanceText(event),/会場/);
  assert.ok(!eventAttendanceText({...event,session_delivery_methods:{[dates[0]]:'ONLINE',[dates[1]]:'ONLINE'}}).includes('会場'));
  assert.match(eventFeeText(event),/複数回合計金額/);assert.match(eventFeeText(event),/再受講用/);assert.match(eventFeeText(event),/¥550/);assert.match(eventFeeText(event),/未設定/);
});
test('session methods and fee tiers persist independently through edits and rescheduling, without changing confirmed receipts',()=>inDatabase(`
  const event=createSeminar({...eventInput,occurrence_type:'MULTIPLE',dates:['2027-01-01','2027-01-08'],delivery_method:'ONLINE',session_delivery_methods:{'2027-01-01':'ONSITE','2027-01-08':'ONLINE'},repeat_fees:{dentist:550,other:0,dental_hygienist:null}});
  assert.equal(event.repeat_fees.dentist,550); assert.equal(event.fee_dentist,20000);
  assert.equal(updateSeminar(event.id,{notes:'保持'}).session_delivery_methods['2027-01-01'],'ONSITE');
  updateSeminar(event.id,{dates:['2027-02-01'],session_delivery_methods:{'2027-02-01':'HYBRID'}});
  const changed=getSeminarById(event.id);assert.equal(changed.session_delivery_methods['2027-01-01'],'ONSITE');assert.equal(changed.session_delivery_methods['2027-02-01'],'HYBRID');assert.equal(changed.repeat_fees.dentist,550);
  const p=createParticipant({...pInput,seminar_id:event.id,payment_status:'paid',paid_amount:550},1), receipts=createReceiptStore(db);
  const issued=receipts.issue(event.id,p.id,1).receipt;
  updateSeminar(event.id,{fee_dentist:99000,repeat_fees:{dentist:1000}});assert.equal(receipts.get(event.id,p.id).amount,550);
  assert.equal(issued.amount,550);
  assert.throws(()=>updateSeminar(event.id,{repeat_fees:{dentist:-1}}),/参加費/);assert.equal(getSeminarById(event.id).repeat_fees.dentist,1000);
`));
