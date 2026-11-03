import { TaskError } from './task.ts';
export type ExternalLecturer={id:number;name:string;facility:string;active:boolean;version:number};
export type ExternalSelection={status:'YES'|'NO'|'UNDECIDED';id:number|null;name:string;facility:string};
export const emptyExternal=():ExternalSelection=>({status:'UNDECIDED',id:null,name:'',facility:''});
export function parseExternalLecturer(value:unknown) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('外部講師の入力形式が不正です');
  const body=value as Record<string,unknown>;
  if(Object.keys(body).some(key=>!['name','facility','active','version'].includes(key)))throw new TaskError('変更できない項目が含まれています');
  if(typeof body.name!=='string'||!body.name.trim()||body.name.trim().length>200)throw new TaskError('氏名は1〜200文字で入力してください');
  if(typeof body.facility!=='string'||!body.facility.trim()||body.facility.trim().length>300)throw new TaskError('勤務施設名は1〜300文字で入力してください');
  if(typeof body.active!=='boolean')throw new TaskError('利用状態が不正です');
  return {name:body.name.trim(),facility:body.facility.trim(),active:body.active};
}
