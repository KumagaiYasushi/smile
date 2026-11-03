import {eventSpeakers,speakerPaymentSummary} from './speaker.ts';
import {TaskError} from './task.ts';
import type {Seminar} from './seminar.ts';
import type {Participant} from './participant.ts';
import {lunchCost} from './lunch.ts';
import type {LunchInput} from './lunch.ts';
export type FinanceSettings={sponsorship:number|null;participation_adjustment:number;other_expenses:number|null;notes:string};
export const emptyFinance=():FinanceSettings=>({sponsorship:null,participation_adjustment:0,other_expenses:null,notes:''});
export function parseFinance(value:unknown):FinanceSettings {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('見積もりの入力形式が不正です');
  const p=value as Record<string,unknown>;
  if(Object.keys(p).some(k=>!Object.hasOwn(emptyFinance(),k)))throw new TaskError('見積もりに変更できない項目が含まれています');
  const result={...emptyFinance(),...p};
  for(const key of ['sponsorship','participation_adjustment','other_expenses'] as const){const n=result[key];if(n===null&&key!=='participation_adjustment')continue;if(typeof n!=='number'||!Number.isSafeInteger(n)||(key!=='participation_adjustment'&&n<0))throw new TaskError('協賛費・その他支出は0以上、参加費調整は増減額を円単位の整数で入力してください');}
  if(typeof result.notes!=='string'||result.notes.length>2000)throw new TaskError('見積もりメモは2000文字以内で入力してください');
  return {...result,notes:result.notes.trim()};
}
export function buildEventEstimate(event:Pick<Seminar,'fee_dental_hygienist'|'fee_dentist'|'fee_other'|'external_lecturer'|'external_payment'|'venue_fee'> & Partial<Pick<Seminar,'lecturer_role'|'lecturer_name'|'speakers'>>,participants:Pick<Participant,'role'|'payment_status'|'paid_amount'>[],lunch:LunchInput[],settings:FinanceSettings){
  const fees={dental_hygienist:event.fee_dental_hygienist,dentist:event.fee_dentist,other:event.fee_other};
  const counts={dental_hygienist:0,dentist:0,other:0};for(const p of participants)counts[p.role]++;
  const feeRows=Object.entries(counts).map(([role,count])=>({role,count,unit:fees[role as keyof typeof fees],total:(BigInt(count)*BigInt(fees[role as keyof typeof fees])).toString()}));
  const participation=feeRows.reduce((sum,p)=>sum+BigInt(p.total),BigInt(0));
  const income=participation+BigInt(settings.participation_adjustment)+BigInt(settings.sponsorship??0);
  const external=event.external_lecturer.status==='YES'||event.external_lecturer.status==='UNDECIDED'&&event.lecturer_role==='EXTERNAL_LECTURER'&&!!event.lecturer_name;
  const perSpeaker=event.speakers==null?null:speakerPaymentSummary(eventSpeakers(event));
  const travel=perSpeaker?(perSpeaker.travelUnknown?null:perSpeaker.travel):external?event.external_payment.travel:0,honorarium=perSpeaker?(perSpeaker.honorariumUnknown?null:perSpeaker.honorarium):external?event.external_payment.honorarium:0;
  const food=lunch.filter(p=>p.status!=='CANCELLED').map(lunchCost);
  const lunchTotal=food.reduce<bigint>((sum,p)=>sum+BigInt(p??0),BigInt(0)),lunchUnknown=food.filter(p=>p===null).length;
  const expenses=BigInt(perSpeaker?.travel??travel??0)+BigInt(perSpeaker?.honorarium??honorarium??0)+BigInt(event.venue_fee)+lunchTotal+BigInt(settings.other_expenses??0);
  return {counts:feeRows,participant_count:participants.length,participation:participation.toString(),paid:participants.filter(p=>p.payment_status==='paid').reduce((sum,p)=>sum+BigInt(p.paid_amount??0),BigInt(0)).toString(),income:income.toString(),expenses:expenses.toString(),balance:(income-expenses).toString(),travel,honorarium,venue:event.venue_fee,lunch:lunchTotal.toString(),lunch_unknown:lunchUnknown,unknown:[...(travel===null?['お車代']:[]),...(honorarium===null?['謝礼']:[]),...(lunchUnknown?['昼食費']:[]),...(settings.sponsorship===null?['協賛費']:[]),...(settings.other_expenses===null?['その他支出']:[])]};
}
export type EventEstimate=ReturnType<typeof buildEventEstimate>;
