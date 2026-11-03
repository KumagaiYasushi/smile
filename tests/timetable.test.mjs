import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {createTimetableStore} from '../lib/timetable.ts';
import {parseTimetable,timetableRows,timetableWindow} from '../types/timetable.ts';
const item=(id,type='BREAK',minutes=10)=>({id,type,title:type==='BREAK'?'休憩':'講演',minutes,speaker_key:null,speaker_name:'',theme:''});
const day={date:'2027-06-01',start:'09:30',items:[item('a','OPENING',5),item('b','LECTURE',45),item('c','BREAK',10),item('d','BREAK',5)]};
const event={id:1,dates:['2027-06-01','2027-06-08'],event_times:{'2027-06-01':{start:'09:30',end:'17:00'}},speakers:[{role:'EXTERNAL_LECTURER',id:7,name:'演者A',facility:'勤務先',theme:'基本治療',payment:{travel:1000,honorarium:20000}}]};
function fixture(){const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec('CREATE TABLE seminars(id INTEGER PRIMARY KEY);INSERT INTO seminars VALUES(1),(2);CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER);INSERT INTO auth_users VALUES(1,1),(2,0)');return {db,store:createTimetableStore(db)};}
test('times follow durations and ordering, repeated types remain separate and midnight limits are validated',()=>{
  const value=parseTimetable({version:0,days:[day]});assert.equal(value.days[0].items.length,4);
  assert.deepEqual(timetableRows(day).map(p=>[p.start,p.end]),[['09:30','09:35'],['09:35','10:20'],['10:20','10:30'],['10:30','10:35']]);
  assert.equal(timetableRows({...day,items:[day.items[1],day.items[0]]})[1].start,'10:15');
  for(const patch of [{start:'9:00'},{items:[{...item('a'),minutes:0}]},{items:[{...item('a'),minutes:1.5}]},{items:[item('a'),item('a')]},{start:'23:59',items:[item('a')]},{items:[{...item('a'),type:'UNKNOWN'}]}])assert.throws(()=>parseTimetable({version:0,days:[{...day,...patch}]}),{status:400});
  assert.equal(timetableRows({date:null,start:'23:50',items:[item('end')]})[0].end,'翌日 00:00');
});
test('save and reload protect event scope and versions, resolve lectures from registered speakers and preserve old dates',()=>{
  const {db,store}=fixture();try{
    const initial=store.read(event);assert.equal(initial.version,0);assert.equal(initial.days.length,2);assert.equal(initial.days[0].start,'09:30');assert.deepEqual(initial.event_times,event.event_times);assert.equal(initial.lectures[0].key,'EXTERNAL_LECTURER:7');assert.ok(!JSON.stringify(initial).includes('honorarium'));
    const lecture={...item('speaker','LECTURE',30),speaker_key:initial.lectures[0].key,speaker_name:'偽の氏名',theme:'偽のテーマ'};
    const saved=store.save(event,{version:0,days:[{...day,items:[...day.items,lecture]}]},1);assert.equal(saved.version,1);assert.equal(saved.days[0].items.at(-1).speaker_name,'演者A');assert.equal(saved.days[0].items.at(-1).theme,'基本治療');assert.deepEqual(store.read(event),saved);
    assert.throws(()=>store.save(event,{version:0,days:[day]},1),{status:409});assert.equal(store.read(event).version,1);
    assert.throws(()=>store.save(event,{version:1,days:[day]},2),{status:403});
    assert.throws(()=>store.save({...event,id:2},{version:0,days:[{...day,items:[{...lecture,speaker_key:'EXTERNAL_LECTURER:999'}]}]},1),{status:400});
    assert.throws(()=>store.save(event,{version:1,days:[{...day,date:'2027-07-01'}]},1),{status:400});
    const changed={...event,dates:['2027-07-01'],speakers:[]};const old=store.read(changed);assert.equal(old.days[0].date,day.date);assert.ok(old.days.some(p=>p.date==='2027-07-01'));
    const kept=store.save(changed,{version:old.version,days:old.days},1);assert.equal(kept.days[0].items.at(-1).speaker_name,'演者A');
    db.prepare('DELETE FROM seminars WHERE id=1').run();assert.equal(db.prepare('SELECT count(*) n FROM event_timetables').get().n,0);assert.throws(()=>store.read(event),{status:404});
  }finally{db.close();}
});
test('undecided-date events can build a timetable and multiple dates remain independent',()=>{
  const {db,store}=fixture();try{
    const undecided={...event,dates:[]};assert.equal(store.read(undecided).days[0].date,null);
    const saved=store.save(undecided,{version:0,days:[{...day,date:null}]},1);assert.equal(saved.days[0].items.length,4);
    const next=store.read(event);assert.equal(next.days.length,3);assert.equal(next.days[1].items.length,0);assert.equal(next.days[2].items.length,0);
    assert.throws(()=>parseTimetable({version:1,days:[day,day]}),{status:400});
  }finally{db.close();}
});

test('basic lecture time defines the available window and remaining/overrun minutes',()=>{
  const range={start:'09:00',end:'10:30'};
  const fit=timetableWindow(day,range);assert.equal(fit.available,90);assert.equal(fit.remaining,-5);assert.equal(fit.beforeStart,false);
  const early=timetableWindow({...day,start:'08:30'},range);assert.equal(early.beforeStart,true);assert.equal(early.remaining,55);
  assert.equal(timetableWindow(day,{start:'09:00',end:null}).remaining,null);
  assert.equal(timetableWindow(day,undefined).available,null);
  assert.equal(timetableWindow({...day,items:[{...item('empty'),minutes:NaN}]},range).remaining,null);
});
