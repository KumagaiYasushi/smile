import { isDeliveryMethod,deliveryMethodLabel } from './seminar.ts';
import type { DeliveryMethod,Seminar } from './seminar.ts';
import { TaskError } from './task.ts';
import type { ParticipantRole } from './participant.ts';
export type SessionMethods=Record<string,DeliveryMethod>;
export type RepeatFees=Record<ParticipantRole,number|null>;
export const emptyRepeatFees=():RepeatFees=>({dental_hygienist:null,dentist:null,other:null});
export function parseSessionMethods(value:unknown,dates:string[]):SessionMethods {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('開催日ごとの開催方法の入力形式が不正です');
  const result:SessionMethods={};
  for(const [date,method] of Object.entries(value)) {
    if(!dates.includes(date)||!isDeliveryMethod(method))throw new TaskError('開催日ごとの開催方法を3択から選択してください');
    result[date]=method;
  }
  return result;
}
export function parseRepeatFees(value:unknown):RepeatFees {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('再受講の参加費の入力形式が不正です');
  const result=emptyRepeatFees();
  for(const [role,fee] of Object.entries(value)) {
    if(!Object.hasOwn(result,role))throw new TaskError('再受講の職種が不正です');
    if(fee!==null&&(typeof fee!=='number'||!Number.isSafeInteger(fee)||fee<0))throw new TaskError('参加費は0円以上の整数で入力してください');
    result[role as ParticipantRole]=fee as number|null;
  }
  return result;
}
export function eventMethodForDate(event:Pick<Seminar,'delivery_method'> & Partial<Pick<Seminar,'session_delivery_methods'>>,date:string):DeliveryMethod|null {
  return event.session_delivery_methods?.[date]??event.delivery_method;
}
export function eventDeliveryLabel(event:Pick<Seminar,'delivery_method'> & Partial<Pick<Seminar,'session_delivery_methods'|'dates'>>):string {
  const methods=event.dates?.length?[...new Set(event.dates.map(date=>eventMethodForDate(event,date)))]:[event.delivery_method];
  return methods.map(deliveryMethodLabel).join(' ／ ');
}
