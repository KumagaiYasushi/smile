import {TaskError} from './task.ts';
export type ExternalPayment={travel:number|null;honorarium:number|null};
export const emptyExternalPayment=():ExternalPayment=>({travel:null,honorarium:null});
export function parseExternalPayment(value:unknown):ExternalPayment {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!['travel','honorarium'].includes(key)))throw new TaskError('外来講師の金額設定が不正です');
  const body=value as Record<string,unknown>,result=emptyExternalPayment();
  for(const key of ['travel','honorarium'] as const){const number=body[key];if(number!==null&&(typeof number!=='number'||!Number.isSafeInteger(number)||number<0))throw new TaskError('お車代・謝礼は0円以上の整数、または未定で入力してください');result[key]=number as number|null;}
  return result;
}
