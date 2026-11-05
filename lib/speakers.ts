import {parseExternalPayment,emptyExternalPayment} from '../types/external-payment.ts';
import {requireDate} from '../types/task-template.ts';
import {speakerPaymentSummary} from '../types/speaker.ts';
import type Database from 'better-sqlite3';
import {TaskError} from '../types/task.ts';
import {SPEAKER_ROLES} from '../types/speaker.ts';
import type {Speaker} from '../types/speaker.ts';
import {createExternalLecturerStore} from './external-lecturers.ts';
import {createSocietyMemberStore} from './society-members.ts';
export function resolveSpeakers(db:Database.Database,value:unknown,current:Speaker[]=[],actorId?:number,dates?:string[]):Speaker[]{
  if(!Array.isArray(value)||value.length>100)throw new TaskError('演者は100名以内で登録してください');
  const external=createExternalLecturerStore(db),society=createSocietyMemberStore(db);
  const seen=new Set<string>();
  const people=value.map(item=>{
    if(!item||typeof item!=='object'||Array.isArray(item))throw new TaskError('演者の入力形式が不正です');
    const p=item as Record<string,unknown>;
    if(Object.keys(p).some(k=>!['role','id','name','facility','theme','payment','date'].includes(k))||typeof p.role!=='string'||!Object.hasOwn(SPEAKER_ROLES,p.role)||typeof p.theme!=='string'||p.theme.length>2000)throw new TaskError('演者区分・テーマの入力が不正です');
    const date=p.date===undefined?undefined:requireDate(p.date);
    if(date&&dates&&!dates.includes(date)&&!current.some(x=>x.date===date&&x.role===p.role&&x.id===p.id))throw new TaskError('演者の登壇日は登録した開催日から選択してください');
    if(p.id!==null&&(typeof p.id!=='number'||!Number.isSafeInteger(p.id)||p.id<1))throw new TaskError('演者を名簿から選択してください');
    if(p.role!=='EXTERNAL_LECTURER'&&p.payment!==undefined)throw new TaskError('支払い設定は外部講師にのみ入力してください');
    const payment=p.role==='EXTERNAL_LECTURER'?parseExternalPayment(p.payment!==undefined?p.payment:current.find(x=>x.role===p.role&&x.id===p.id&&x.name===p.name&&x.date===date)?.payment??emptyExternalPayment()):undefined;
    let person:{id:number|null;name:string;facility?:string;active?:boolean}|undefined;
    if(p.role==='EXTERNAL_LECTURER'){
      if(p.id===null){
        if(typeof p.name!=='string'||typeof p.facility!=='string')throw new TaskError('氏名・勤務施設名を入力してください');
        const name=p.name.trim(),facility=p.facility.trim();
        person=external.list().find(x=>x.name===name&&x.facility===facility);
        if(!person){if(!actorId)throw new TaskError('名簿への保存にはログインが必要です',403);person=external.save({name:p.name,facility:p.facility,active:true},actorId);}
      }else person=external.list().find(x=>x.id===p.id);
    }else person=society.list().find(x=>x.id===p.id&&x.role===p.role);
    const previous=current.find(x=>x.role===p.role&&x.id===p.id&&x.name===p.name&&x.date===date);
    if((!person||person.active===false)&&!previous)throw new TaskError('利用中の名簿から演者を選択してください');
    const result:Speaker={role:p.role as Speaker['role'],id:person?.id??previous!.id,name:person?.name??previous!.name,facility:person?.facility??previous?.facility??'',theme:p.theme.trim(),...(date?{date}:{}),...(payment?{payment}:{})};
    const identity=`${result.role}:${result.id??result.name}`,key=`${identity}@${date??'*'}`;if(seen.has(key)||peopleOverlap())throw new TaskError('同じ演者が重複しています');seen.add(key);return result;
    function peopleOverlap(){return date?seen.has(`${identity}@*`):[...seen].some(key=>key.startsWith(`${identity}@`));}
  });
  speakerPaymentSummary(people);return people;
}
