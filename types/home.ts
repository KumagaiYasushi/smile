import {eventSessionName} from './event-session.ts';
import type {Seminar,EventType} from './seminar.ts';
import type {Meeting} from './meeting.ts';
export type HomeKind=EventType|'MEETING';
export type HomeRow={key:string;kind:HomeKind;event_id:number;event_name:string;parent_type:EventType;title:string;date:string|null;time:string|null;meeting_id:number|null};
export function buildHomeRows(events:(Pick<Seminar,'id'|'name'|'event_type'|'dates'|'event_times'> & Partial<Pick<Seminar,'occurrence_type'>>)[],meetings:Meeting[]):HomeRow[] {
  const rows:HomeRow[]=events.flatMap(event=>(event.dates.length?[...new Set(event.dates)]:[null]).map(date=>({key:`event-${event.id}-${date??'undated'}`,kind:event.event_type,event_id:event.id,event_name:date?eventSessionName(event,date):event.name,parent_type:event.event_type,title:'イベント開催',date,time:date?event.event_times[date]?.start??null:null,meeting_id:null})));
  for(const meeting of meetings){const event=events.find(e=>e.id===meeting.seminar_id);if(event)rows.push({key:`meeting-${meeting.id}`,kind:'MEETING',event_id:event.id,event_name:event.name,parent_type:event.event_type,title:meeting.title,date:meeting.date,time:meeting.time,meeting_id:meeting.id});}
  return rows.sort((a,b)=>(a.date??'9999-99-99').localeCompare(b.date??'9999-99-99')||(a.time??'').localeCompare(b.time??'')||a.event_id-b.event_id||a.key.localeCompare(b.key));
}
