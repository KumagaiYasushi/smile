import {emptyExternalPayment} from './external-payment.ts';
import type {ExternalPayment} from './external-payment.ts';
import {TaskError} from './task.ts';
import type {Seminar} from './seminar.ts';
export const SPEAKER_ROLES={EXTERNAL_LECTURER:'外部講師',SOCIETY_LECTURER:'研究会講師',SOCIETY_SUPPORT:'研究会サポートメンバー'} as const;
export type Speaker={role:keyof typeof SPEAKER_ROLES;id:number|null;name:string;facility:string;theme:string;date?:string;payment?:ExternalPayment};
export function eventSpeakers(event:Partial<Seminar>):Speaker[]{
  if(event.speakers!=null){
    const external=event.speakers.filter(p=>p.role==='EXTERNAL_LECTURER');
    const legacy=!external.some(p=>p.payment!==undefined);
    const owner=external.find(p=>p.id===event.external_lecturer?.id)??external[0];
    return event.speakers.map(p=>p.role==='EXTERNAL_LECTURER'?{...p,payment:p.payment??(legacy&&p===owner?event.external_payment:undefined)??emptyExternalPayment()}:p);
  }
  const people:Speaker[]=[];
  if(event.external_lecturer?.status==='YES'&&event.external_lecturer.name)people.push({role:'EXTERNAL_LECTURER',id:event.external_lecturer.id,name:event.external_lecturer.name,facility:event.external_lecturer.facility,theme:'',payment:event.external_payment??emptyExternalPayment()});
  if(event.lecturer_name&&(event.lecturer_role!=='EXTERNAL_LECTURER'||event.external_lecturer?.status==='UNDECIDED')&&!people.some(p=>p.name===event.lecturer_name))people.push({role:event.lecturer_role??'SOCIETY_LECTURER',id:null,name:event.lecturer_name,facility:'',theme:'',...(event.lecturer_role==='EXTERNAL_LECTURER'?{payment:event.external_payment??emptyExternalPayment()}:{})});
  return people;
}

export function speakerPaymentSummary(people:Speaker[]){
  let travel=0,honorarium=0,travelUnknown=0,honorariumUnknown=0;
  for(const p of people.filter(p=>p.role==='EXTERNAL_LECTURER')){
    const payment=p.payment??emptyExternalPayment();
    if(payment.travel===null)travelUnknown++;else travel+=payment.travel;
    if(payment.honorarium===null)honorariumUnknown++;else honorarium+=payment.honorarium;
  }
  if(!Number.isSafeInteger(travel)||!Number.isSafeInteger(honorarium))throw new TaskError('外部講師の支払い合計が大きすぎます');
  return {travel,honorarium,travelUnknown,honorariumUnknown};
}
export function speakerPaymentTotal(people:Speaker[]):ExternalPayment{
  const s=speakerPaymentSummary(people);return {travel:s.travelUnknown?null:s.travel,honorarium:s.honorariumUnknown?null:s.honorarium};
}

export function speakerKey(person:Speaker){return `${person.role}:${person.id??person.name}${person.date?`@${person.date}`:''}`;}
