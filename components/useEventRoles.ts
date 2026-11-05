'use client';
import {useEffect,useState} from 'react';
import {apiJson} from '@/lib/client-api';
import {emptyRoleAssignments,roleAssignmentSubmission,EVENT_DAY_ROLES,dayRoleAttendance,rolesForDate,aggregateDayRoles} from '@/types/event-roles';
import type {EventRoleKey,RoleAssignmentData,RoleAssignee} from '@/types/event-roles';
import {attendanceDateKeys} from '@/types/staff-attendance';
import type {StaffRoster} from '@/types/staff-roster';
import type {SocietyMember} from '@/types/society-member';
export function useEventRoles(eventId?:number){
  const [data,setData]=useState<RoleAssignmentData>({assignments:emptyRoleAssignments(),version:0,members:[],day_assignments:{}}),[dirty,setDirty]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  function apply(value:RoleAssignmentData){setData(value);setDirty(false);setError('');}
  useEffect(()=>{const controller=new AbortController();(eventId?apiJson(`/api/seminars/${eventId}/roles`,{signal:controller.signal}):apiJson('/api/society-members',{signal:controller.signal}).then(result=>({assignments:emptyRoleAssignments(),version:0,members:result.members,day_assignments:{}}))).then(result=>{if(!controller.signal.aborted)apply(result);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[eventId]);
  function toggle(key:EventRoleKey,member:SocietyMember|RoleAssignee,date?:string){setData(current=>{
    const dayRole=Object.hasOwn(EVENT_DAY_ROLES,key),targetDate=date??attendanceDateKeys(current.attendance?.dates??[])[0];
    const selectedPeople=dayRole?rolesForDate(current,targetDate)[key as keyof typeof EVENT_DAY_ROLES]:current.assignments[key];
    const id='id'in member?member.id:member.member_id,selected=selectedPeople.some(p=>p.member_id===id),next='id'in member?{member_id:member.id,member_version:member.version,name:member.name,role:member.role}:member;
    const people=selected?selectedPeople.filter(p=>p.member_id!==id):[...selectedPeople,next];
    if(!dayRole)return {...current,assignments:{...current.assignments,[key]:people}};
    const days={...current.day_assignments,[targetDate]:{...rolesForDate(current,targetDate),[key]:people}};
    return {...current,day_assignments:days,assignments:aggregateDayRoles(current.assignments,days,current.attendance?attendanceDateKeys(current.attendance.dates):Object.keys(days))};
  });setDirty(true);}
  function removeAbsentDayAssignees(roster:StaffRoster){
    const days={...data.day_assignments};let changed=false;
    for(const date of attendanceDateKeys(roster.dates)){
      const previous=rolesForDate(data,date),next={...previous};
      for(const key of Object.keys(EVENT_DAY_ROLES) as (keyof typeof EVENT_DAY_ROLES)[]){next[key]=previous[key].filter(p=>!dayRoleAttendance(roster,p.member_id,date).blocked);if(next[key].length!==previous[key].length)changed=true;}
      days[date]=next;
    }
    if(changed){setData({...data,day_assignments:days,assignments:aggregateDayRoles(data.assignments,days,attendanceDateKeys(roster.dates))});setDirty(true);}
  }
  function payload(dates?:string[]){if(!dirty)return undefined;const active=dates?attendanceDateKeys(dates):null;const submission=!eventId&&active&&data.day_assignments?{...data,day_assignments:Object.fromEntries(Object.entries(data.day_assignments).filter(([date])=>active.includes(date)))}:data;return roleAssignmentSubmission(submission,data.members);}
  async function reload(){if(dirty&&!confirm('編集中の役割担当を破棄して、最新の担当・名簿を取得しますか？'))return;setLoading(true);setError('');try{apply(eventId?await apiJson(`/api/seminars/${eventId}/roles`):{assignments:emptyRoleAssignments(),version:0,members:(await apiJson('/api/society-members')).members,day_assignments:{}});}catch(e){setError(e instanceof Error?e.message:'担当・名簿を取得できませんでした');}finally{setLoading(false);}}
  return {data,dirty,loading,error,toggle,payload,reload,apply,removeAbsentDayAssignees};
}
