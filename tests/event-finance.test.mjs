import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {emptyFinance,parseFinance,buildEventEstimate} from '../types/event-finance.ts';
import {createFinanceStore} from '../lib/event-finance.ts';
import {emptyLunch} from '../types/lunch.ts';
import {newSocialPlan,socialTotal,parseSocialGathering,emptySocialGathering,formatSocialPlanDateTime,mergeSocialGathering} from '../types/social-gathering.ts';
const event={id:1,fee_dental_hygienist:5000,fee_dentist:10000,fee_other:0,external_lecturer:{status:'YES'},external_payment:{travel:1000,honorarium:20000},venue_fee:10000};
test('estimates count unpaid applications once at course fees, sum active lunch, sponsorship and adjustments separately from received amounts',()=>{
  const people=[{role:'dentist',payment_status:'paid',paid_amount:9000},{role:'dental_hygienist',payment_status:'unpaid',paid_amount:null},{role:'other',payment_status:'unpaid',paid_amount:null}];
  const food=[{...emptyLunch(),quantity:3,unit_price:800},{...emptyLunch(),status:'CANCELLED',quantity:100,unit_price:500},{...emptyLunch(),quantity:null}];
  const estimate=buildEventEstimate(event,people,food,{...emptyFinance(),sponsorship:30000,participation_adjustment:-1000,other_expenses:600});
  assert.equal(estimate.participation,'15000');assert.equal(estimate.income,'44000');assert.equal(estimate.paid,'9000');assert.equal(estimate.lunch,'2400');assert.equal(estimate.expenses,'34000');assert.equal(estimate.balance,'10000');assert.equal(estimate.participant_count,3);assert.deepEqual(estimate.unknown,['昼食費']);
  const none=buildEventEstimate({...event,external_lecturer:{status:'NO'}},[],[],emptyFinance());assert.equal(none.travel,0);assert.equal(none.honorarium,0);assert.equal(none.balance,'-10000');
  const large=buildEventEstimate({...event,fee_dentist:Number.MAX_SAFE_INTEGER},Array(3).fill(people[0]),[],emptyFinance());assert.equal(large.participation,(BigInt(Number.MAX_SAFE_INTEGER)*3n).toString());
});
test('finance settings reject invalid/forged values and preserve null versus zero',()=>{
  assert.equal(parseFinance({sponsorship:0}).sponsorship,0);assert.equal(parseFinance({}).sponsorship,null);
  for(const value of [null,[],{sponsorship:-1},{other_expenses:1.5},{participation_adjustment:null},{sponsorship:'100'},{actor_id:1},{notes:'x'.repeat(2001)}])assert.throws(()=>parseFinance(value),{status:400});
});
test('finance edits have version guards, scope, valid actors and parent deletion',()=>{
  const db=new Database(':memory:');try{db.pragma('foreign_keys=ON');db.exec(`CREATE TABLE seminars(id INTEGER PRIMARY KEY,name TEXT,dates TEXT);INSERT INTO seminars VALUES(1,'会計検証','[]'),(2,'別イベント','[]');CREATE TABLE participants(seminar_id INTEGER,role TEXT,payment_status TEXT,paid_amount INTEGER);CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER);INSERT INTO auth_users VALUES(1,1),(2,0);`);
    const store=createFinanceStore(db);assert.equal(store.read(event).version,0);
    const saved=store.save(event,{...emptyFinance(),sponsorship:0,version:0},1);assert.equal(saved.version,1);assert.equal(saved.settings.sponsorship,0);
    assert.throws(()=>store.save(event,{...emptyFinance(),version:0},1),{status:409});assert.throws(()=>store.save(event,{...emptyFinance(),version:1},2),{status:403});assert.equal(store.read({...event,id:2}).version,0);
    db.prepare('DELETE FROM seminars WHERE id=1').run();assert.equal(db.prepare('SELECT count(*) n FROM event_finance').get().n,0);
  }finally{db.close();}
});
test('on-day gathering dates default chronologically and retain editable date-only values, while totals distinguish unknown/free and large amounts',()=>{
  const first=newSocialPlan('ON_DAY','one',['2027-06-08','2027-06-01']),second=newSocialPlan('ON_DAY','two',['2027-06-08','2027-06-01'],1);
  assert.equal(first.start_date,'2027-06-01');assert.equal(second.start_date,'2027-06-08');assert.equal(newSocialPlan('BEFORE','before',['2027-06-01']).start_date,null);
  const saved=parseSocialGathering({...emptySocialGathering(),status:'HELD',timings:['ON_DAY'],gatherings:[{...first,start_date:'2027-06-02',end_date:'2027-06-02'}]});assert.match(formatSocialPlanDateTime(saved.gatherings[0]),/2027年06月02日（時刻未定）/);assert.equal(mergeSocialGathering(saved,{start_at:'2027-06-03T18:00'}).gatherings[0].start_date,'2027-06-03');
  assert.equal(socialTotal({participants:10,fee:5000}),'50000');assert.equal(socialTotal({participants:0,fee:0}),'0');assert.equal(socialTotal({participants:null,fee:5000}),null);
  assert.throws(()=>parseSocialGathering({...saved,gatherings:[{...first,start_date:'2027-02-30'}]}),{status:400});assert.throws(()=>parseSocialGathering({...saved,gatherings:[{...first,start_at:'2027-06-02T18:00'}]}),{status:400});
});

test('per-speaker payments sum once and known amounts remain in expenses when another speaker is undecided',()=>{
  const speakers=[{role:'EXTERNAL_LECTURER',id:1,name:'講師A',facility:'',theme:'',payment:{travel:1000,honorarium:10000}},{role:'EXTERNAL_LECTURER',id:2,name:'講師B',facility:'',theme:'',payment:{travel:null,honorarium:20000}}];
  const estimate=buildEventEstimate({...event,speakers},[],[],emptyFinance());
  assert.equal(estimate.travel,null);assert.equal(estimate.honorarium,30000);assert.equal(estimate.expenses,'41000');assert.ok(estimate.unknown.includes('お車代'));
  assert.equal(buildEventEstimate({...event,speakers:[]},[],[],emptyFinance()).expenses,'10000');
});
