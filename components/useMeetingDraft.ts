'use client';
import {useEffect,useState,useRef} from 'react';
import {apiJson} from '@/lib/client-api';
import {meetingSubmission} from '@/types/meeting';
import type {MeetingInput,MeetingData,MeetingDraft,MeetingChange} from '@/types/meeting';
import type {SocietyMember} from '@/types/society-member';
export function useMeetingDraft(eventId?:number) {
  const [plans,setPlans]=useState<MeetingDraft[]>([]),[removed,setRemoved]=useState<MeetingChange[]>([]),[members,setMembers]=useState<SocietyMember[]>([]);
  const [loading,setLoading]=useState(true),[error,setError]=useState('');const serial=useRef(0);
  function apply(result:MeetingData){
    setMembers(result.members);setPlans(result.meetings.map(meeting=>{
      const {id,version,seminar_id,...fields}=meeting;void seminar_id;
      const attendees=fields.attendees.map(p=>({...p,member_version:result.members.find(m=>m.id===p.member_id)?.version??p.member_version}));
      for(const member of result.members.filter(p=>p.active&&!attendees.some(a=>a.member_id===p.id)))attendees.push({member_id:member.id,member_version:member.version,name:member.name,role:member.role,response:'UNANSWERED'});
      return {key:`saved-${id}`,id,version,data:{...fields,attendees},dirty:false};
    }));setRemoved([]);
  }
  useEffect(()=>{const controller=new AbortController();
    (eventId?apiJson(`/api/seminars/${eventId}/meetings`,{signal:controller.signal}):apiJson('/api/society-members',{signal:controller.signal}).then(data=>({meetings:[],members:data.members})))
      .then(data=>{if(!controller.signal.aborted)apply(data);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
  },[eventId]);
  function add(){setPlans(current=>[...current,{key:`new-${++serial.current}`,dirty:true,data:{title:`打ち合わせ ${current.length+1}`,date:null,time:null,method:'ONSITE',attendees:members.filter(p=>p.active).map(p=>({member_id:p.id,member_version:p.version,name:p.name,role:p.role,response:'UNANSWERED'}))}}]);}
  function update(key:string,data:MeetingInput){setPlans(current=>current.map(p=>p.key===key?{...p,data,dirty:true}:p));}
  function remove(key:string){const p=plans.find(p=>p.key===key);if(!p)return;if(p.id!==undefined)setRemoved(current=>[...current,{action:'delete',id:p.id!,version:p.version!}]);setPlans(current=>current.filter(p=>p.key!==key));}
  function payload():MeetingChange[]{return [...removed,...plans.filter(p=>p.dirty).map(p=>p.id===undefined?{action:'create' as const,data:meetingSubmission(p.data)}:{action:'update' as const,id:p.id,version:p.version!,data:meetingSubmission(p.data)})];}
  async function reload(){if((plans.some(p=>p.dirty)||removed.length)&&!confirm('編集中の打ち合わせを破棄して最新情報を取得しますか？'))return;setLoading(true);setError('');try{if(eventId)apply(await apiJson(`/api/seminars/${eventId}/meetings`));else apply({meetings:[],members:(await apiJson('/api/society-members')).members});}catch(e){setError(e instanceof Error?e.message:'打ち合わせを取得できませんでした');}finally{setLoading(false);}}
  return {plans,members,loading,error,add,update,remove,payload,reload,apply};
}
