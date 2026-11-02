import {TaskError} from './task.ts';
import {requireDate} from './task-template.ts';
import {ROSTER_RESPONSE_LABELS} from './staff-roster.ts';
import type {RosterResponse} from './staff-roster.ts';
import type {SocietyMember} from './society-member.ts';
export const MEETING_METHOD_LABELS={ONSITE:'実開催',ONLINE:'オンライン',OTHER:'その他'} as const;
export type MeetingMethod=keyof typeof MEETING_METHOD_LABELS;
export type MeetingAttendee={member_id:number;member_version:number;response:RosterResponse;name?:string;role?:SocietyMember['role']};
export type MeetingInput={title:string;date:string|null;time:string|null;method:MeetingMethod;attendees:MeetingAttendee[]};
export type Meeting=MeetingInput & {id:number;seminar_id:number;version:number};
export type MeetingChange={action:'create';data:MeetingInput}|{action:'update';id:number;version:number;data:MeetingInput}|{action:'delete';id:number;version:number};
export type MeetingDraft={key:string;id?:number;version?:number;data:MeetingInput;dirty:boolean};
export type MeetingData={meetings:Meeting[];members:SocietyMember[]};
export function parseMeeting(value:unknown):MeetingInput {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('打ち合わせの入力形式が不正です');
  const body=value as Record<string,unknown>;
  if(Object.keys(body).some(key=>!['title','date','time','method','attendees'].includes(key)))throw new TaskError('打ち合わせに変更できない項目が含まれています');
  if(typeof body.title!=='string'||!body.title.trim()||body.title.trim().length>200)throw new TaskError('打ち合わせ名は1〜200文字で入力してください');
  const date=body.date===null?null:requireDate(body.date);
  if(body.time!==null&&(typeof body.time!=='string'||!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(body.time)))throw new TaskError('打ち合わせの時刻が不正です');
  if(body.time&&!date)throw new TaskError('時刻を設定する場合は日付も入力してください');
  if(typeof body.method!=='string'||!Object.hasOwn(MEETING_METHOD_LABELS,body.method))throw new TaskError('打ち合わせの開催方法を選択してください');
  if(!Array.isArray(body.attendees)||body.attendees.length>1000)throw new TaskError('打ち合わせの出欠形式が不正です');
  const ids=new Set<number>();
  const attendees=body.attendees.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('打ち合わせの出欠形式が不正です');
    const p=value as Record<string,unknown>;
    if(Object.keys(p).some(key=>!['member_id','member_version','response'].includes(key))||typeof p.member_id!=='number'||!Number.isSafeInteger(p.member_id)||p.member_id<1||ids.has(p.member_id))throw new TaskError('打ち合わせの名簿IDが不正または重複しています');
    ids.add(p.member_id);
    if(typeof p.member_version!=='number'||!Number.isSafeInteger(p.member_version)||p.member_version<1||typeof p.response!=='string'||!Object.hasOwn(ROSTER_RESPONSE_LABELS,p.response))throw new TaskError('打ち合わせの名簿情報または出欠が不正です');
    return {member_id:p.member_id,member_version:p.member_version,response:p.response as RosterResponse};
  });
  return {title:body.title.trim(),date,time:body.time as string|null,method:body.method as MeetingMethod,attendees};
}
export function meetingSubmission(data:MeetingInput):MeetingInput {
  const fields={...data} as unknown as Record<string,unknown>;
  for(const key of ['id','seminar_id','version'])delete fields[key];
  return parseMeeting({...fields,attendees:data.attendees.map(({member_id,member_version,response})=>({member_id,member_version,response}))});
}
