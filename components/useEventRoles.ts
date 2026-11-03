'use client';
import {useEffect,useState} from 'react';
import {apiJson} from '@/lib/client-api';
import {emptyRoleAssignments,roleAssignmentSubmission} from '@/types/event-roles';
import type {EventRoleKey,RoleAssignmentData,RoleAssignee} from '@/types/event-roles';
import type {SocietyMember} from '@/types/society-member';
export function useEventRoles(eventId?:number){
  const [data,setData]=useState<RoleAssignmentData>({assignments:emptyRoleAssignments(),version:0,members:[]}),[dirty,setDirty]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
  function apply(value:RoleAssignmentData){setData(value);setDirty(false);setError('');}
  useEffect(()=>{const controller=new AbortController();(eventId?apiJson(`/api/seminars/${eventId}/roles`,{signal:controller.signal}):apiJson('/api/society-members',{signal:controller.signal}).then(result=>({assignments:emptyRoleAssignments(),version:0,members:result.members}))).then(result=>{if(!controller.signal.aborted)apply(result);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[eventId]);
  function toggle(key:EventRoleKey,member:SocietyMember|RoleAssignee){setData(current=>{const selected=current.assignments[key].some(p=>p.member_id===('id'in member?member.id:member.member_id)),id='id'in member?member.id:member.member_id;const next='id'in member?{member_id:member.id,member_version:member.version,name:member.name,role:member.role}:member;return {...current,assignments:{...current.assignments,[key]:selected?current.assignments[key].filter(p=>p.member_id!==id):[...current.assignments[key],next]}};});setDirty(true);}
  function payload(){return dirty?roleAssignmentSubmission(data,data.members):undefined;}
  async function reload(){if(dirty&&!confirm('編集中の役割担当を破棄して、最新の担当・名簿を取得しますか？'))return;setLoading(true);setError('');try{apply(eventId?await apiJson(`/api/seminars/${eventId}/roles`):{assignments:emptyRoleAssignments(),version:0,members:(await apiJson('/api/society-members')).members});}catch(e){setError(e instanceof Error?e.message:'担当・名簿を取得できませんでした');}finally{setLoading(false);}}
  return {data,dirty,loading,error,toggle,payload,reload,apply};
}
