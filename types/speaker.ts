import type {Seminar} from './seminar.ts';
export const SPEAKER_ROLES={EXTERNAL_LECTURER:'外部講師',SOCIETY_LECTURER:'研究会講師',SOCIETY_SUPPORT:'研究会サポートメンバー'} as const;
export type Speaker={role:keyof typeof SPEAKER_ROLES;id:number|null;name:string;facility:string;theme:string};
export function eventSpeakers(event:Partial<Seminar>):Speaker[]{
  if(event.speakers!=null)return event.speakers;
  const people:Speaker[]=[];
  if(event.external_lecturer?.status==='YES'&&event.external_lecturer.name)people.push({role:'EXTERNAL_LECTURER',id:event.external_lecturer.id,name:event.external_lecturer.name,facility:event.external_lecturer.facility,theme:''});
  if(event.lecturer_name&&(event.lecturer_role!=='EXTERNAL_LECTURER'||event.external_lecturer?.status==='UNDECIDED')&&!people.some(p=>p.name===event.lecturer_name))people.push({role:event.lecturer_role??'SOCIETY_LECTURER',id:null,name:event.lecturer_name,facility:'',theme:''});
  return people;
}
