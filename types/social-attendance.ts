import {TaskError} from './task.ts';
import type {SocietyMember} from './society-member.ts';
import type {ExternalSelection} from './external-lecturer.ts';
export const SOCIAL_ATTENDANCE_ROLES={SOCIETY_LECTURER:'研究会講師',SOCIETY_SUPPORT:'研究会サポートメンバー',EXTERNAL_LECTURER:'外部講師',OTHER:'その他'} as const;
export type SocialAttendee={key:string;role:keyof typeof SOCIAL_ATTENDANCE_ROLES;member_id:number|null;name:string;facility:string;response:'ATTENDING'|'ABSENT'|null};
export function parseSocialAttendance(value:unknown):SocialAttendee[] {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>1000)throw new TaskError('懇親会の出欠は1000名以内で登録してください');
  const keys=new Set<string>(),people=new Set<string>();
  return value.map(person=>{
    if(!person||typeof person!=='object'||Array.isArray(person))throw new TaskError('懇親会の出欠形式が不正です');
    const p=person as Record<string,unknown>;
    if(Object.keys(p).some(k=>!['key','role','member_id','name','facility','response'].includes(k))||typeof p.key!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(p.key)||keys.has(p.key))throw new TaskError('懇親会の出欠IDが不正または重複しています');
    keys.add(p.key);
    if(typeof p.role!=='string'||!Object.hasOwn(SOCIAL_ATTENDANCE_ROLES,p.role))throw new TaskError('懇親会の出欠区分が不正です');
    if(p.member_id!==null&&(typeof p.member_id!=='number'||!Number.isSafeInteger(p.member_id)||p.member_id<1)||p.role==='OTHER'&&p.member_id!==null||(p.role==='SOCIETY_LECTURER'||p.role==='SOCIETY_SUPPORT')&&p.member_id===null)throw new TaskError('懇親会の名簿IDが不正です');
    if(typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>200||typeof p.facility!=='string'||p.facility.length>300)throw new TaskError('懇親会の氏名は1〜200文字、勤務施設名は300文字以内で入力してください');
    if(p.response!==null&&p.response!=='ATTENDING'&&p.response!=='ABSENT')throw new TaskError('懇親会の出欠は出席・欠席から選択してください');
    if(p.role!=='OTHER') {const identity=`${p.role==='EXTERNAL_LECTURER'?'external':'society'}-${p.member_id??'saved'}`;if(people.has(identity))throw new TaskError('懇親会の名簿が重複しています');people.add(identity);}
    return {key:p.key,role:p.role as SocialAttendee['role'],member_id:p.member_id as number|null,name:p.name.trim(),facility:p.facility.trim(),response:p.response};
  });
}
export function socialAttendanceCandidates(saved:SocialAttendee[],members:SocietyMember[],external:ExternalSelection):SocialAttendee[] {
  const result=saved.map(p=>({...p}));
  for(const m of members.filter(p=>p.active))if(!result.some(p=>p.role!=='OTHER'&&p.role!=='EXTERNAL_LECTURER'&&p.member_id===m.id))result.push({key:`society-${m.id}`,role:m.role,member_id:m.id,name:m.name,facility:'',response:null});
  if(external.status==='YES'&&external.name&&!result.some(p=>p.role==='EXTERNAL_LECTURER'&&p.member_id===external.id))result.push({key:`external-${external.id??'saved'}`,role:'EXTERNAL_LECTURER',member_id:external.id,name:external.name,facility:external.facility,response:null});
  return result;
}
