import type {Seminar,EventType} from './seminar.ts';
import type {Meeting} from './meeting.ts';
import {eventSessionName} from './event-session.ts';
import {eventMethodForDate} from './event-options.ts';
import {normalizeSocialGathering,SOCIAL_TIMING_LABELS} from './social-gathering.ts';
export const ENTRY_KIND_LABELS={EVENT:'イベント',MEETING:'打ち合わせ',SOCIAL:'懇親会'} as const;
export type EventListEntry={key:string;kind:keyof typeof ENTRY_KIND_LABELS;seminar_id:number;event_type:EventType;parent_name:string;name:string;date:string|null;start:string|null;end:string|null;end_date:string|null;venue:string;href:string};
export function buildEventList(events:Seminar[],meetings:Meeting[]):EventListEntry[]{
 const result:EventListEntry[]=[];
 for(const e of events){
  for(const date of e.dates.length?[...new Set(e.dates)].sort():[null]){const time=date?e.event_times[date]:undefined;result.push({key:`event-${e.id}-${date??'undated'}`,kind:'EVENT',seminar_id:e.id,event_type:e.event_type,parent_name:e.name,name:date?eventSessionName(e,date):e.name,date,start:time?.start??null,end:time?.end??null,end_date:date,venue:eventMethodForDate(e,date??'')==='ONLINE'?'オンライン':e.venue||'会場未設定',href:`/seminars/${e.id}`});}
  for(const m of meetings.filter(m=>m.seminar_id===e.id))result.push({key:`meeting-${m.id}`,kind:'MEETING',seminar_id:e.id,event_type:e.event_type,parent_name:e.name,name:m.title,date:m.date,start:m.time,end:m.end_time??null,end_date:m.date,venue:m.method==='ONLINE'?'オンライン':m.method==='ONSITE'?'現地開催（会場未設定）':'開催方法：その他',href:`/seminars/${e.id}/meetings`});
  const social=normalizeSocialGathering(e.social_gathering);
  if(social.status==='HELD')for(const g of social.gatherings.filter(g=>social.timings.includes(g.timing)))result.push({key:`social-${e.id}-${g.id}`,kind:'SOCIAL',seminar_id:e.id,event_type:e.event_type,parent_name:e.name,name:`${e.name}の懇親会（${SOCIAL_TIMING_LABELS[g.timing]}）`,date:g.start_at?.slice(0,10)??g.start_date??null,start:g.start_at?.slice(11,16)??null,end:g.end_at?.slice(11,16)??null,end_date:g.end_at?.slice(0,10)??g.end_date??null,venue:g.venue||'お店未設定',href:`/seminars/${e.id}`});
 }
 return result.sort((a,b)=>(a.date??'9999-99-99').localeCompare(b.date??'9999-99-99')||(a.start??'').localeCompare(b.start??'')||a.seminar_id-b.seminar_id||a.key.localeCompare(b.key));
}
