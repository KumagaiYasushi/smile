'use client';

import { useCallback,useEffect,useRef,useState } from 'react';
import { apiJson } from '@/lib/client-api';
import { parseLunch } from '@/types/lunch';
import type { LunchData,LunchInput } from '@/types/lunch';
import {countLunchAttendance} from '@/types/lunch-defaults';
import type {ExternalSelection} from '@/types/external-lecturer';
import type {StaffPerson} from '@/types/staff-attendance';
import type { SocietyMember } from '@/types/society-member';
import type { StaffRoster,StaffRosterRow,RosterResponse } from '@/types/staff-roster';
import type { AttendanceDraft,EventRegistration,LunchChange,LunchDraft } from '@/types/event-registration';

export function useEventRegistration(eventId?:number) {
  const [roster,setRoster]=useState<StaffRoster|null>(null);
  const [lunch,setLunch]=useState<LunchDraft[]>([]);
  const [removed,setRemoved]=useState<LunchChange[]>([]);
  const [attendance,setAttendance]=useState<Record<number,AttendanceDraft>>({});
  const [loading,setLoading]=useState(true),[error,setError]=useState('');
  const serial=useRef(0);
  const [otherStaff,setOtherStaff]=useState<StaffPerson[]>([]),[participantCount,setParticipantCount]=useState(0);
  const load=useCallback(async(signal?:AbortSignal):Promise<{roster:StaffRoster;lunch:LunchDraft[];people:StaffPerson[];participantCount:number}>=>{
    if(eventId) {
      const [staff,food,participants]:[{roster:StaffRoster;people:StaffPerson[]},LunchData,unknown[]]=await Promise.all([apiJson(`/api/seminars/${eventId}/staff-attendance`,{signal}),apiJson(`/api/seminars/${eventId}/lunch`,{signal}),apiJson(`/api/seminars/${eventId}/participants`,{signal})]);
      return {roster:staff.roster,people:staff.people,participantCount:participants.length,lunch:food.plans.map(plan=>{
        const {id,version,date,target,targets,quantities,target_details,quantity,unit_price,additional_cost,shop_name,shop_contact,menu,notes,status}=plan;
        return {key:`saved-${id}`,id,version,dirty:false,data:{date,target,...(targets?{targets}:{}),...(quantities?{quantities}:{}),target_details,quantity,unit_price,additional_cost,shop_name,shop_contact,menu,notes,status}};
      })};
    }
    const data:{members:SocietyMember[]}=await apiJson('/api/society-members',{signal});
    return {roster:{dates:[],rows:data.members.filter(p=>p.active).map(p=>({member_id:p.id,member_version:p.version,directory_name:p.name,active:p.active,name:p.name,role:p.role,person_id:null,version:0,responses:{}}))},lunch:[],people:[],participantCount:0};
  },[eventId]);
  const apply=useCallback((data:{roster:StaffRoster;lunch:LunchDraft[];people:StaffPerson[];participantCount:number})=>{
    setRoster(data.roster);setOtherStaff(data.people);setParticipantCount(data.participantCount);setLunch(data.lunch);setAttendance({});setRemoved([]);
  },[]);
  useEffect(()=>{
    const controller=new AbortController();
    load(controller.signal).then(data=>{if(!controller.signal.aborted)apply(data);})
      .catch(error=>{if(!controller.signal.aborted)setError(error instanceof Error?error.message:'出欠・昼食を取得できませんでした');})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return()=>controller.abort();
  },[load,apply]);
  function setResponse(row:StaffRosterRow,date:string,response:RosterResponse) {
    setRoster(current=>current?{...current,rows:current.rows.map(p=>p.member_id===row.member_id?{...p,responses:{...p.responses,[date]:response}}:p)}:current);
    setAttendance(current=>({...current,[row.member_id]:{member_id:row.member_id,member_version:row.member_version,version:row.version,responses:{...current[row.member_id]?.responses,[date]:response}}}));
  }
  function addLunch(data:LunchInput){setLunch(current=>[...current,{key:`new-${++serial.current}`,data,dirty:true}]);}
  function updateLunch(key:string,data:LunchInput){setLunch(current=>current.map(p=>p.key===key?{...p,data,dirty:true}:p));}
  function removeLunch(key:string){const plan=lunch.find(p=>p.key===key);if(!plan)return;
    if(plan.id!==undefined&&plan.version!==undefined)setRemoved(current=>[...current,{action:'delete',id:plan.id!,version:plan.version!}]);
    setLunch(current=>current.filter(p=>p.key!==key));
  }
  const dirty=Object.keys(attendance).length>0||lunch.some(p=>p.dirty)||removed.length>0;
  function payload(dates:string[]):EventRegistration|undefined {
    if(!dirty)return undefined;
    const keys=dates.length?dates:[''];
    const people=Object.values(attendance).map(row=>({...row,responses:Object.fromEntries(Object.entries(row.responses).filter(([date])=>keys.includes(date)))})).filter(row=>Object.keys(row.responses).length>0);
    const changes:LunchChange[]=[...removed,...lunch.filter(p=>p.dirty).map(p=>p.id===undefined?{action:'create' as const,data:parseLunch(p.data)}:{action:'update' as const,id:p.id,version:p.version!,data:parseLunch(p.data)})];
    return {schedule:[...dates].sort(),attendance:people,lunch:changes};
  }
  async function reload(){
    if(dirty&&!confirm('編集中の出欠・昼食を破棄して、最新情報を取得しますか？'))return;
    setLoading(true);setError('');
    try{apply(await load());}catch(error){setError(error instanceof Error?error.message:'出欠・昼食を取得できませんでした');}finally{setLoading(false);}
  }
  function getLunchCounts(date:string|null,external:ExternalSelection) {
    const linked=new Set(roster?.rows.map(row=>row.person_id).filter(id=>id!==null));
    const counts=countLunchAttendance([...(roster?.rows??[]),...otherStaff.filter(p=>!linked.has(p.id))],date,participantCount);
    const registered=otherStaff.find(p=>p.role==='EXTERNAL_LECTURER'&&p.name===external.name);
    counts.EXTERNAL_LECTURER=external.status==='YES'&&external.name?(registered?.responses[date??'']!==undefined?(registered.responses[date??'']==='ATTENDING'?1:0):1):0;
    return counts;
  }
  return {roster,lunch,loading,error,dirty,getLunchCounts,setResponse,addLunch,updateLunch,removeLunch,payload,reload};
}
