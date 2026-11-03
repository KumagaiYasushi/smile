import type Database from 'better-sqlite3';
import type {Seminar} from '../types/seminar.ts';
import {eventSpeakers} from '../types/speaker.ts';
import {parseTimetable} from '../types/timetable.ts';
import type {TimetableData} from '../types/timetable.ts';
import {TaskError} from '../types/task.ts';
export function createTimetableStore(db:Database.Database){
  db.exec(`CREATE TABLE IF NOT EXISTS event_timetables(seminar_id INTEGER PRIMARY KEY REFERENCES seminars(id) ON DELETE CASCADE,days_json TEXT NOT NULL CHECK(json_valid(days_json)),version INTEGER NOT NULL DEFAULT 1,actor_id INTEGER NOT NULL,updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);
  function read(event:Seminar):TimetableData{
    if(!db.prepare('SELECT id FROM seminars WHERE id=?').get(event.id))throw new TaskError('イベントが見つかりません',404);
    const row=db.prepare('SELECT days_json,version FROM event_timetables WHERE seminar_id=?').get(event.id) as {days_json:string;version:number}|undefined;
    const dates=event.dates.length?[...event.dates].sort():[null];
    const days:TimetableData['days']=row?JSON.parse(row.days_json):[];
    for(const date of dates)if(!days.some(p=>p.date===date))days.push({date,start:date?event.event_times[date]?.start??'09:00':'09:00',items:[]});
    return {version:row?.version??0,days,event_dates:event.dates,event_times:event.event_times,lectures:eventSpeakers(event).map(p=>({key:`${p.role}:${p.id??p.name}`,name:p.name,theme:p.theme}))};
  }
  return {read,save(event:Seminar,value:unknown,actorId:number):TimetableData{return db.transaction(()=>{
    if(!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId))throw new TaskError('有効な運営メンバーとしてログインしてください',403);
    const current=read(event),input=parseTimetable(value);
    if(input.version!==current.version)throw new TaskError('別の操作でタイムスケジュールが更新されています。最新の内容を再取得してください',409);
    const choices=new Map(current.lectures.map(p=>[p.key,p]));
    for(const day of input.days){
      if(day.date!==null&&!event.dates.includes(day.date)&&!current.days.some(p=>p.date===day.date))throw new TaskError('登録済みの開催日を選択してください');
      for(const item of day.items){
        if(!item.speaker_key){item.speaker_name='';item.theme='';continue;}
        const person=choices.get(item.speaker_key),previous=current.days.flatMap(p=>p.items).find(p=>p.id===item.id&&p.speaker_key===item.speaker_key);
        if(!person&&!previous)throw new TaskError('イベントに登録済みの演者を選択してください');
        item.speaker_name=person?.name??previous!.speaker_name;item.theme=person?.theme??previous!.theme;
      }
    }
    db.prepare(`INSERT INTO event_timetables(seminar_id,days_json,actor_id) VALUES(?,?,?) ON CONFLICT(seminar_id) DO UPDATE SET days_json=excluded.days_json,version=event_timetables.version+1,actor_id=excluded.actor_id,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).run(event.id,JSON.stringify(input.days),actorId);
    return read(event);
  }).immediate();}};
}
