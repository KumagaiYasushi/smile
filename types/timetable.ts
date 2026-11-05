import {isTenMinuteTime} from './time-input.ts';
import type {EventTimes} from './event-schedule.ts';
import {TaskError,parseVersion} from './task.ts';
import {requireDate} from './task-template.ts';
export const TIMETABLE_TYPES={OPENING:'開会の挨拶',GREETING:'挨拶',BREAK:'休憩',LUNCH_BREAK:'昼休憩',LECTURE:'講演',PRACTICE_INDIVIDUAL:'実習(個人)',PRACTICE_PAIR:'実習(相互)',CLASSROOM_LECTURE:'講義',CASE_REVIEW:'症例検討会',DISCUSSION:'ディスカッション',GROUP_DISCUSSION:'グループディスカッション',CLOSING:'閉会の挨拶',SPONSOR_CM:'協賛CM'} as const;
export type TimetableType=keyof typeof TIMETABLE_TYPES;
export type TimetableChair={member_id:number;name:string};
export type TimetableItem={id:string;type:TimetableType;title:string;minutes:number;speaker_key:string|null;speaker_name:string;theme:string;chairs:TimetableChair[]};
export type TimetableDay={date:string|null;start:string;items:TimetableItem[]};
export type Timetable={version:number;days:TimetableDay[]};
export type LectureChoice={key:string;name:string;theme:string;date?:string};
export type TimetableData=Timetable & {event_dates:string[];event_times:EventTimes;lectures:LectureChoice[];chair_choices:Record<string,TimetableChair[]>};
export function timeMinutes(time:string){const [h,m]=time.split(':').map(Number);return h*60+m;}
export function clockText(minutes:number){if(!Number.isFinite(minutes))return '—';return `${minutes>=1440?'翌日 ':''}${String(Math.floor(minutes/60)%24).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;}
export function timetableRows(day:TimetableDay){let minute=timeMinutes(day.start);return day.items.map(item=>{const start=minute;minute+=item.minutes;return {...item,start:clockText(start),end:clockText(minute)};});}
export function parseTimetable(value:unknown):Timetable {
  function object(value:unknown){if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('タイムスケジュールの入力形式が不正です');return value as Record<string,unknown>;}
  const body=object(value);if(Object.keys(body).some(k=>!['version','days'].includes(k)))throw new TaskError('変更できない項目が含まれています');
  const version=body.version===0?0:parseVersion(body.version);
  if(!Array.isArray(body.days)||body.days.length>101)throw new TaskError('日程は101件以内で入力してください');
  const dates=new Set<string|null>(),ids=new Set<string>();let count=0;
  const days=body.days.map(value=>{const day=object(value);
    if(Object.keys(day).some(k=>!['date','start','items'].includes(k)))throw new TaskError('日程の入力形式が不正です');
    const date=day.date===null?null:requireDate(day.date);if(dates.has(date))throw new TaskError('タイムスケジュールの日程が重複しています');dates.add(date);
    if(!isTenMinuteTime(day.start))throw new TaskError('開始時刻は10分単位で入力してください');
    if(!Array.isArray(day.items)||day.items.length>200)throw new TaskError('各日程の項目は200件以内で入力してください');
    const items=day.items.map(value=>{const p=object(value);count++;
      if(Object.keys(p).some(k=>!['id','type','title','minutes','speaker_key','speaker_name','theme','chairs'].includes(k)))throw new TaskError('タイムスケジュール項目の入力形式が不正です');
      if(typeof p.id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(p.id)||ids.has(p.id))throw new TaskError('項目IDが重複しているか不正です');ids.add(p.id);
      if(typeof p.type!=='string'||!Object.hasOwn(TIMETABLE_TYPES,p.type)||typeof p.title!=='string'||!p.title.trim()||p.title.length>300)throw new TaskError('項目名は1〜300文字で入力してください');
      if(typeof p.minutes!=='number'||!Number.isSafeInteger(p.minutes)||p.minutes<1||p.minutes>1440)throw new TaskError('所要時間は1〜1440分の整数で入力してください');
      if(p.speaker_key!==null&&(typeof p.speaker_key!=='string'||p.speaker_key.length>500||p.type!=='LECTURE'))throw new TaskError('演者は講演にのみ設定できます');
      for(const key of ['speaker_name','theme'])if(typeof p[key]!=='string'||(p[key] as string).length>2000)throw new TaskError('演者情報の入力形式が不正です');
      const rawChairs=p.chairs===undefined?[]:p.chairs;
      if(!Array.isArray(rawChairs)||rawChairs.length>1000||(p.type!=='LECTURE'&&rawChairs.length))throw new TaskError('座長は講演にのみ設定できます');
      const chairIds=new Set<number>();
      const chairs=rawChairs.map(value=>{const chair=object(value);if(Object.keys(chair).some(key=>!['member_id','name'].includes(key))||typeof chair.member_id!=='number'||!Number.isSafeInteger(chair.member_id)||chair.member_id<1||chairIds.has(chair.member_id)||typeof chair.name!=='string'||chair.name.length>200)throw new TaskError('座長の入力形式が不正または重複しています');chairIds.add(chair.member_id);return {member_id:chair.member_id,name:chair.name};});
      return {chairs,id:p.id,type:p.type as TimetableType,title:p.title.trim(),minutes:p.minutes,speaker_key:p.speaker_key as string|null,speaker_name:p.speaker_name as string,theme:p.theme as string};
    });
    if(timeMinutes(day.start)+items.reduce((s,p)=>s+p.minutes,0)>1440)throw new TaskError('終了が翌日になります。所要時間か開始時刻を調整してください');
    return {date,start:day.start,items};
  });
  if(count>1000)throw new TaskError('項目はイベント全体で1000件以内にしてください');return {version,days};
}

export function timetableWindow(day:TimetableDay,range:{start:string;end:string|null}|undefined){
  const total=day.items.reduce((sum,p)=>sum+p.minutes,0),start=timeMinutes(day.start),end=start+total;
  return {total,end,beforeStart:range?start<timeMinutes(range.start):false,remaining:range?.end&&Number.isFinite(end)?timeMinutes(range.end)-end:null,available:range?.end?timeMinutes(range.end)-timeMinutes(range.start):null};
}
