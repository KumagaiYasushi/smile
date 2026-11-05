import {attendanceDateKeys} from './staff-attendance.ts';
import type {StaffRoster} from './staff-roster.ts';
import {requireDate} from './task-template.ts';
import {TaskError} from './task.ts';
import type {SocietyMember,SocietyRole} from './society-member.ts';
export const PREPARATION_ROLES={VENUE:'会場担当',EXTERNAL_LECTURER:'外部講師担当',LUNCH:'昼食担当',ACCOUNTING:'会計担当',WEB:'告知WEB担当',SPONSORSHIP:'協賛担当'} as const;
export const EVENT_DAY_ROLES={RECEPTION:'受付',MC:'総合司会',CHAIR:'座長',SOCIAL:'懇親会'} as const;
export const EVENT_ROLES={...PREPARATION_ROLES,...EVENT_DAY_ROLES};
export type EventRoleKey=keyof typeof EVENT_ROLES;
export type EventDayRoleKey=keyof typeof EVENT_DAY_ROLES;
export type DayRoleAssignments=Record<EventDayRoleKey,RoleAssignee[]>;
export type RoleMemberInput={member_id:number;member_version:number};
export type RoleAssignee=RoleMemberInput & {name:string;role:SocietyRole};
export type RoleAssignments=Record<EventRoleKey,RoleAssignee[]>;
export type RoleAssignmentInput={version:number;assignments:Record<EventRoleKey,RoleMemberInput[]>;day_assignments?:Record<string,Record<EventDayRoleKey,RoleMemberInput[]>>};
export type RoleAssignmentData={version:number;assignments:RoleAssignments;members:SocietyMember[];attendance?:StaffRoster;day_assignments?:Record<string,DayRoleAssignments>};
export const emptyRoleAssignments=():RoleAssignments=>Object.fromEntries(Object.keys(EVENT_ROLES).map(key=>[key,[] as RoleAssignee[]])) as RoleAssignments;
export function parseRoleAssignments(value:unknown):RoleAssignmentInput {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('役割担当の入力形式が不正です');
  const p=value as Record<string,unknown>;
  if(Object.keys(p).some(key=>!['version','assignments','day_assignments'].includes(key))||typeof p.version!=='number'||!Number.isSafeInteger(p.version)||p.version<0)throw new TaskError('役割担当のバージョンが不正です');
  if(!p.assignments||typeof p.assignments!=='object'||Array.isArray(p.assignments))throw new TaskError('役割担当の入力形式が不正です');
  const assignments=p.assignments as Record<string,unknown>;
  if(Object.keys(assignments).length!==Object.keys(EVENT_ROLES).length||Object.keys(assignments).some(key=>!Object.hasOwn(EVENT_ROLES,key)))throw new TaskError('準備役割・当日役割の10項目を指定してください');
  const result=Object.fromEntries(Object.keys(EVENT_ROLES).map(key=>{
    const list=assignments[key];if(!Array.isArray(list)||list.length>1000)throw new TaskError('各役割の担当者は1000名以内で選択してください');
    const ids=new Set<number>();return [key,list.map(person=>{
      if(!person||typeof person!=='object'||Array.isArray(person))throw new TaskError('担当者は研究会名簿から選択してください');const m=person as Record<string,unknown>;
      if(Object.keys(m).some(k=>!['member_id','member_version'].includes(k))||typeof m.member_id!=='number'||!Number.isSafeInteger(m.member_id)||m.member_id<1||ids.has(m.member_id)||typeof m.member_version!=='number'||!Number.isSafeInteger(m.member_version)||m.member_version<1)throw new TaskError('担当者が不正または重複しています');ids.add(m.member_id);return {member_id:m.member_id,member_version:m.member_version};
    })];
  })) as RoleAssignmentInput['assignments'];
  const output:RoleAssignmentInput={version:p.version,assignments:result};
  if(p.day_assignments!==undefined){
    if(!p.day_assignments||typeof p.day_assignments!=='object'||Array.isArray(p.day_assignments)||Object.keys(p.day_assignments).length>201)throw new TaskError('日別の役割担当の形式が不正です');
    output.day_assignments=Object.fromEntries(Object.entries(p.day_assignments).map(([date,roles])=>{
      if(date!=='')requireDate(date);
      if(!roles||typeof roles!=='object'||Array.isArray(roles)||Object.keys(roles).length!==4||Object.keys(roles).some(k=>!Object.hasOwn(EVENT_DAY_ROLES,k)))throw new TaskError('日別の当日役割4項目を指定してください');
      const parsed=parseRoleAssignments({version:0,assignments:{...emptyRoleAssignments(),...roles}});
      return [date,Object.fromEntries(Object.keys(EVENT_DAY_ROLES).map(k=>[k,parsed.assignments[k as EventDayRoleKey]])) as Record<EventDayRoleKey,RoleMemberInput[]>];
    }));
  }
  return output;
}
export function roleAssignmentSubmission(data:Pick<RoleAssignmentData,'version'|'assignments'|'day_assignments'>,members:SocietyMember[]):RoleAssignmentInput {
  const people=(list:RoleAssignee[])=>list.map(p=>({member_id:p.member_id,member_version:members.find(m=>m.id===p.member_id)?.version??p.member_version}));
  return parseRoleAssignments({version:data.version,...(data.day_assignments?{day_assignments:Object.fromEntries(Object.entries(data.day_assignments).map(([date,roles])=>[date,Object.fromEntries(Object.entries(roles).map(([key,list])=>[key,people(list)]))]))}:{}),assignments:Object.fromEntries(Object.entries(data.assignments).map(([key,people])=>[key,people.map(p=>({member_id:p.member_id,member_version:members.find(m=>m.id===p.member_id)?.version??p.member_version}))]))});
}

export function dayRoleAttendance(roster:StaffRoster|null|undefined,memberId:number,date?:string){
  const row=roster?.rows.find(p=>p.member_id===memberId),dates=date===undefined?attendanceDateKeys(roster?.dates??[]):[date];
  const absentDates=dates.filter(date=>row?.responses[date]==='ABSENT');
  return {blocked:absentDates.length===dates.length,partial:absentDates.length>0&&absentDates.length<dates.length,absentDates};
}

export const emptyDayRoles=():DayRoleAssignments=>Object.fromEntries(Object.keys(EVENT_DAY_ROLES).map(key=>[key,[] as RoleAssignee[]])) as DayRoleAssignments;
export function rolesForDate(data:Pick<RoleAssignmentData,'assignments'|'day_assignments'>,date:string):DayRoleAssignments{
  return data.day_assignments?data.day_assignments[date]??emptyDayRoles():Object.fromEntries(Object.keys(EVENT_DAY_ROLES).map(k=>[k,data.assignments[k as EventDayRoleKey]])) as DayRoleAssignments;
}
export function aggregateDayRoles(assignments:RoleAssignments,days:Record<string,DayRoleAssignments>,dates:string[]):RoleAssignments{
  const next={...assignments};for(const key of Object.keys(EVENT_DAY_ROLES) as EventDayRoleKey[]){const people=dates.flatMap(date=>days[date]?.[key]??[]);next[key]=people.filter((p,i)=>people.findIndex(m=>m.member_id===p.member_id)===i);}return next;
}
