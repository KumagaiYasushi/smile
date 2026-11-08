import test from 'node:test';
import assert from 'node:assert/strict';
import {buildEventList} from '../types/event-list.ts';
const event={id:1,name:'架空コース',event_type:'BASIC_COURSE',occurrence_type:'MULTIPLE',dates:['2027-06-10','2027-06-20'],event_times:{'2027-06-10':{start:'10:00',end:'17:00'}},delivery_method:'ONSITE',session_delivery_methods:{},venue:'イベント会場',social_gathering:{status:'HELD',timings:['BEFORE','ON_DAY'],gatherings:[{id:'before',timing:'BEFORE',start_at:'2027-06-09T19:00',end_at:'2027-06-09T21:00',venue:'架空店A'},{id:'after',timing:'ON_DAY',start_at:null,end_at:null,start_date:'2027-06-20',venue:'架空店B'},{id:'hidden',timing:'AFTER',start_at:null,venue:'対象外'}]}};
test('separate event sessions, meetings and each held social plan into date order without duplicates',()=>{
 const rows=buildEventList([event],[{id:1,seminar_id:1,title:'準備会',date:'2027-06-01',time:'20:00',end_time:'22:00',method:'ONLINE'},{id:2,seminar_id:1,title:'未定会議',date:null,time:null,method:'ONSITE'}]);
 assert.equal(rows.length,6);assert.equal(rows[0].kind,'MEETING');assert.equal(rows[0].venue,'オンライン');assert.equal(rows[0].end,'22:00');assert.equal(rows[1].name,'架空コースの懇親会（事前）');assert.equal(rows[1].venue,'架空店A');assert.equal(rows[2].name,'架空コース 第1回');assert.equal(rows[2].venue,'イベント会場');assert.equal(rows.at(-1).date,null);assert.notEqual(rows.at(-1).venue,event.venue);assert.equal(new Set(rows.map(r=>r.key)).size,rows.length);assert(rows.every(r=>r.event_type==='BASIC_COURSE'));assert.equal(rows[0].href,'/seminars/1/meetings');
});
test('exclude undecided or cancelled social plans and unrelated meetings while retaining undated events',()=>{
 for(const status of ['NOT_HELD','UNDECIDED'])assert.equal(buildEventList([{...event,social_gathering:{...event.social_gathering,status}}],[]).length,2);
 const rows=buildEventList([{...event,dates:[],social_gathering:{status:'HELD',start_at:'2027-06-01T19:00',end_at:null,venue:'旧形式のお店',fee:null}}],[{id:99,seminar_id:2}]);assert.equal(rows.length,2);assert.equal(rows[0].kind,'SOCIAL');assert.equal(rows[0].venue,'旧形式のお店');assert.equal(rows[1].date,null);
});
test('use per-date online venue, sort shared dates by time, and keep social IDs event-scoped',()=>{
 const online={...event,delivery_method:'ONLINE',session_delivery_methods:{'2027-06-20':'ONSITE'}};const rows=buildEventList([online,{...online,id:2}],[]);assert.equal(rows.filter(r=>r.kind==='EVENT'&&r.date==='2027-06-10')[0].venue,'オンライン');assert.equal(rows.filter(r=>r.kind==='EVENT'&&r.date==='2027-06-20')[0].venue,'イベント会場');assert.equal(new Set(rows.map(r=>r.key)).size,rows.length);
});
