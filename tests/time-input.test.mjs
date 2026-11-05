import test from 'node:test';
import assert from 'node:assert/strict';
import {isTenMinuteTime,isMinuteTime} from '../types/time-input.ts';
import {parseEventTimes} from '../types/event-schedule.ts';
import {parseMeeting} from '../types/meeting.ts';
import {parseSocialGathering} from '../types/social-gathering.ts';
import {parseTimetable} from '../types/timetable.ts';

test('all user-entered times accept only ten-minute increments in the 24-hour clock',()=>{
  for(let hour=0;hour<24;hour++)for(let minute=0;minute<60;minute++)assert.equal(isTenMinuteTime(`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`),minute%10===0);
  for(const value of [null,undefined,0,'','9:00','24:00','12:60','09:30:00'])assert.equal(isTenMinuteTime(value),false);
});

test('events, meetings and social gatherings enforce ten-minute inputs when saved',()=>{
  const date='2027-06-01';
  for(const time of ['00:00','09:30','18:10','23:50']){
    assert.equal(parseEventTimes({[date]:{start:time,end:null}},[date])[date].start,time);
    assert.equal(parseMeeting({title:'打ち合わせ',date,time,method:'ONSITE',attendees:[]}).time,time);
    assert.equal(parseSocialGathering({status:'HELD',start_at:`${date}T${time}`,end_at:null,venue:'',fee:null}).start_at,`${date}T${time}`);
    assert.equal(parseTimetable({version:0,days:[{date,start:time,items:[]}]}).days[0].start,time);
  }
  for(const time of ['09:05','12:15','18:31','23:59']){
    assert.throws(()=>parseEventTimes({[date]:{start:time,end:null}},[date]),/10分/);
    assert.throws(()=>parseEventTimes({[date]:{start:'00:00',end:time}},[date]),/10分/);
    assert.throws(()=>parseMeeting({title:'打ち合わせ',date,time,method:'ONSITE',attendees:[]}),/10分/);
    assert.throws(()=>parseSocialGathering({status:'HELD',start_at:`${date}T${time}`,end_at:null,venue:'',fee:null}),/10分/);
    assert.throws(()=>parseSocialGathering({status:'HELD',start_at:null,end_at:`${date}T${time}`,venue:'',fee:null}),/10分/);

  }
});


test('timetable starts and durations use five-minute increments',()=>{
  for(let hour=0;hour<24;hour++)for(let minute=0;minute<60;minute++)assert.equal(isMinuteTime(`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`,5),minute%5===0);
  for(const time of ['09:05','12:15','23:55'])assert.equal(parseTimetable({version:0,days:[{date:null,start:time,items:[]}]}).days[0].start,time);
  for(const time of ['09:01','12:12','23:59'])assert.throws(()=>parseTimetable({version:0,days:[{date:null,start:time,items:[]}]}),/5分/);
  const item={id:'a',type:'BREAK',title:'休憩',minutes:5,speaker_key:null,speaker_name:'',theme:''};assert.equal(parseTimetable({version:0,days:[{date:null,start:'09:05',items:[item]}]}).days[0].items[0].minutes,5);
  assert.throws(()=>parseTimetable({version:0,days:[{date:null,start:'09:05',items:[{...item,minutes:7}]}]}),/5分/);
});
