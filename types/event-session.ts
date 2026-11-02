import type {Seminar} from './seminar.ts';
import {formatEventDate} from './event-schedule.ts';
type SessionEvent=Pick<Seminar,'name'|'dates'> & Partial<Pick<Seminar,'occurrence_type'>>;
export function eventSessionNumber(event:Pick<Seminar,'dates'>,date:string):number|null {
  const index=[...new Set(event.dates)].sort().indexOf(date);return index<0?null:index+1;
}
export function eventSessionName(event:SessionEvent,date:string):string {
  const number=eventSessionNumber(event,date);
  return event.occurrence_type==='MULTIPLE'&&number!==null?`${event.name} 第${number}回`:event.name;
}
export function eventSessionDateText(event:SessionEvent & Partial<Pick<Seminar,'event_times'>>,date:string):string {
  return `${event.occurrence_type==='MULTIPLE'?eventSessionName(event,date)+'\n':''}${formatEventDate(date,event.event_times)}`;
}
