import type {Seminar} from './seminar.ts';
import type {Meeting} from './meeting.ts';
import {normalizeSocialGathering} from './social-gathering.ts';
export type GoogleScheduleEvent={summary:string;location:string;description:string;start:{date?:string;dateTime?:string;timeZone?:string};end:{date?:string;dateTime?:string;timeZone?:string}};
export type CalendarDesired={key:string;payload:GoogleScheduleEvent};
export function nextDate(date:string){const d=new Date(`${date}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10);}
function timed(start:string,end:string|null){
  const finish=end&&end>start?end:new Date(Date.parse(`${start}+09:00`)+3600000).toLocaleString('sv-SE',{timeZone:'Asia/Tokyo'}).replace(' ','T').slice(0,16);
  return {start:{dateTime:`${start}:00+09:00`,timeZone:'Asia/Tokyo'},end:{dateTime:`${finish}:00+09:00`,timeZone:'Asia/Tokyo'}};
}
export function calendarEvents(event:Seminar,meetings:Meeting[],origin:string):CalendarDesired[]{
  const description=`研究会システムで管理する予定です。\n${origin}/seminars/${event.id}`;
  const result:CalendarDesired[]=event.dates.map((date)=>{
    const time=event.event_times[date];
    return {key:`event:${date}`,payload:{summary:`${event.name}${event.dates.length>1?` 第${[...event.dates].sort().indexOf(date)+1}回`:''}`,location:event.venue,description,...(time?timed(`${date}T${time.start}`,time.end?`${date}T${time.end}`:null):{start:{date},end:{date:nextDate(date)}})}};
  });
  for(const m of meetings){if(!m.date)continue;result.push({key:`meeting:${m.id}`,payload:{summary:`【打ち合わせ】${m.title}｜${event.name}`,location:m.method==='ONLINE'?'オンライン':'',description,...(m.time?timed(`${m.date}T${m.time}`,m.end_time?`${m.date}T${m.end_time}`:null):{start:{date:m.date},end:{date:nextDate(m.date)}})}});}
  const social=normalizeSocialGathering(event.social_gathering);
  if(social.status==='HELD')for(const g of social.gatherings.filter(g=>social.timings.includes(g.timing))){
    const date=g.start_at?.slice(0,10)??g.start_date;if(!date)continue;
    result.push({key:`social:${g.id}`,payload:{summary:`【懇親会】${event.name}`,location:g.venue,description,...(g.start_at?timed(g.start_at,g.end_at):{start:{date},end:{date:nextDate(g.end_date&&g.end_date>=date?g.end_date:date)}})}});
  }
  return result;
}
