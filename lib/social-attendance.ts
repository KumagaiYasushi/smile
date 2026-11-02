import type Database from 'better-sqlite3';
import {TaskError} from '../types/task.ts';
import type {SocialGathering} from '../types/social-gathering.ts';
import type {ExternalSelection} from '../types/external-lecturer.ts';
import {createSocietyMemberStore} from './society-members.ts';
// Resolve new directory choices on the server; saved names remain snapshots.
export function resolveSocialAttendance(db:Database.Database,value:SocialGathering,external:ExternalSelection,current?:SocialGathering):SocialGathering {
  if(!value.gatherings?.some(p=>p.attendees?.length))return value;
  const members=new Map(createSocietyMemberStore(db).list().map(p=>[p.id,p]));
  return {...value,gatherings:value.gatherings.map(plan=>({...plan,...(plan.attendees?{attendees:plan.attendees.map(person=>{
    if(person.role==='OTHER')return person;
    const saved=current?.gatherings?.find(p=>p.id===plan.id)?.attendees?.find(p=>p.key===person.key&&p.role===person.role&&p.member_id===person.member_id);
    if(saved)return {...saved,response:person.response};
    if(person.role==='EXTERNAL_LECTURER') {
      if(external.status!=='YES'||external.id!==person.member_id||!external.name)throw new TaskError('懇親会の外来講師を選び直してください');
      return {...person,name:external.name,facility:external.facility};
    }
    const member=members.get(person.member_id!);
    if(!member||!member.active||member.role!==person.role)throw new TaskError('懇親会の研究会名簿を再取得してください');
    return {...person,name:member.name,facility:''};
  })}:{})}))};
}
