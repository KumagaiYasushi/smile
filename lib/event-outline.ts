import type {Seminar} from '../types/seminar.ts';
import {EVENT_TYPE_LABELS,deliveryMethodLabel} from '../types/seminar.ts';
import {eventMethodForDate} from '../types/event-options.ts';
import {formatEventDate,OCCURRENCE_LABELS} from '../types/event-schedule.ts';
import {normalizeSocialGathering,SOCIAL_TIMING_LABELS,formatSocialDateTime} from '../types/social-gathering.ts';
import {AUDIENCE_LABELS} from '../types/audience.ts';
import type {EventOutline} from '../types/event-outline.ts';
export function buildEventOutline(event:Seminar):EventOutline {
  const online=event.dates.length?event.dates.every(date=>eventMethodForDate(event,date)==='ONLINE'):event.delivery_method==='ONLINE';
  const lecturers=[];
  if(event.external_lecturer.status==='YES'&&event.external_lecturer.name)lecturers.push({name:event.external_lecturer.name,facility:event.external_lecturer.facility});
  const useLegacyLecturer=event.lecturer_role!=='EXTERNAL_LECTURER'||event.external_lecturer.status==='UNDECIDED';
  if(useLegacyLecturer&&event.lecturer_name&&!lecturers.some(person=>person.name===event.lecturer_name))lecturers.push({name:event.lecturer_name,facility:''});
  const social=normalizeSocialGathering(event.social_gathering);
  return {
    event_id:event.id,organization:'歯周基本治療研究会',name:event.name,event_type:EVENT_TYPE_LABELS[event.event_type],occurrence:event.occurrence_type?OCCURRENCE_LABELS[event.occurrence_type]:'未設定',content:event.content,
    schedule:event.dates.map(date=>({date,when:formatEventDate(date,event.event_times),method:deliveryMethodLabel(eventMethodForDate(event,date))})),
    venue:online?null:event.venue,lecturers,audience:event.target_participants,
    fees:[{label:AUDIENCE_LABELS.dental_hygienist,amount:event.fee_dental_hygienist},{label:AUDIENCE_LABELS.dentist,amount:event.fee_dentist},{label:AUDIENCE_LABELS.other,amount:event.fee_other}],
    repeat_fees:event.occurrence_type==='MULTIPLE'?Object.entries(AUDIENCE_LABELS).map(([role,label])=>({label,amount:event.repeat_fees[role as keyof typeof event.repeat_fees]})):null,
    gatherings:social.status==='HELD'?Object.keys(SOCIAL_TIMING_LABELS).flatMap(timing=>social.timings.includes(timing as keyof typeof SOCIAL_TIMING_LABELS)?social.gatherings.filter(p=>p.timing===timing).map(p=>({timing:SOCIAL_TIMING_LABELS[p.timing],start:formatSocialDateTime(p.start_at),end:formatSocialDateTime(p.end_at),venue:p.venue,fee:p.fee})):[]):[],
  };
}
