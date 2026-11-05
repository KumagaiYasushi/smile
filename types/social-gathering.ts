import {isTenMinuteTime} from './time-input.ts';
import {parseSocialAttendance} from './social-attendance.ts';
import type {SocialAttendee} from './social-attendance.ts';
import {requireDate} from './task-template.ts';
import { TaskError } from './task.ts';

export const SOCIAL_STATUS_LABELS = { UNDECIDED: '未定', HELD: '開催する', NOT_HELD: '開催しない' } as const;
export type SocialStatus = keyof typeof SOCIAL_STATUS_LABELS;
export const SOCIAL_TIMING_LABELS={BEFORE:'事前',ON_DAY:'開催日',AFTER:'終了後'} as const;
export type SocialTiming=keyof typeof SOCIAL_TIMING_LABELS;
export type SocialPlan={id:string;timing:SocialTiming;start_at:string|null;end_at:string|null;venue:string;fee:number|null;budget:number|null;participants:number|null;attendees?:SocialAttendee[];start_date?:string|null;end_date?:string|null};
export type SocialGathering = {
  status: SocialStatus;
  start_at: string | null;
  end_at: string | null;
  venue: string;
  fee: number | null;
  timings?:SocialTiming[];
  gatherings?:SocialPlan[];
};

export function emptySocialGathering(): SocialGathering {
  return { status: 'UNDECIDED', start_at: null, end_at: null, venue: '', fee: null };
}

function dateTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/.test(value)
    || value.startsWith('0000') || !Number.isFinite(Date.parse(`${value}:00Z`))
    || new Date(`${value}:00Z`).toISOString().slice(0, 16) !== value) throw new TaskError('懇親会の日時が不正です');
  if(!isTenMinuteTime(value.slice(11,16)))throw new TaskError('懇親会の時刻は10分単位で入力してください');
  return value;
}

function parseSingleGathering(value: unknown): SocialGathering {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('懇親会の入力形式が不正です');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['status', 'start_at', 'end_at', 'venue', 'fee'].includes(key))) throw new TaskError('懇親会に変更できない項目が含まれています');
  if (typeof body.status !== 'string' || !Object.hasOwn(SOCIAL_STATUS_LABELS, body.status)) throw new TaskError('懇親会の開催有無を選択してください');
  const start = dateTime(body.start_at), end = dateTime(body.end_at);
  if (end && !start) throw new TaskError('懇親会の終了日時を登録する場合は開始日時も入力してください');
  if (start && end && end < start) throw new TaskError('懇親会の終了日時は開始日時以降にしてください');
  if (body.venue !== undefined && (typeof body.venue !== 'string' || body.venue.length > 2000)) throw new TaskError('懇親会の場所は2000文字以内で入力してください');
  const fee = body.fee === undefined ? null : body.fee;
  if (fee !== null && (typeof fee !== 'number' || !Number.isSafeInteger(fee) || fee < 0)) throw new TaskError('懇親会の参加費は0円以上の整数で入力してください');
  return { status: body.status as SocialStatus, start_at: start, end_at: end, venue: (body.venue as string | undefined)?.trim() ?? '', fee };
}

export function emptySocialPlan(timing:SocialTiming,id:string):SocialPlan {
  return {id,timing,start_at:null,end_at:null,venue:'',fee:null,budget:null,participants:null};
}
export function normalizeSocialGathering(value:SocialGathering):SocialGathering & {timings:SocialTiming[];gatherings:SocialPlan[]} {
  if(value.gatherings!==undefined&&value.timings!==undefined)return {...value,timings:value.timings,gatherings:value.gatherings};
  const hasLegacy=value.status==='HELD'||!!value.start_at||!!value.end_at||!!value.venue||value.fee!==null;
  return {...value,timings:hasLegacy?['ON_DAY']:[],gatherings:hasLegacy?[{...emptySocialPlan('ON_DAY','legacy'),start_at:value.start_at,end_at:value.end_at,venue:value.venue,fee:value.fee}]:[]};
}
export function withSocialPlans(value:SocialGathering,timings:SocialTiming[],gatherings:SocialPlan[]):SocialGathering {
  const first=gatherings.find(plan=>timings.includes(plan.timing));
  return {...value,...(first?{start_at:first.start_at,end_at:first.end_at,venue:first.venue,fee:first.fee}:{}),timings,gatherings};
}
export function parseSocialGathering(value:unknown):SocialGathering {
  if(!value||typeof value!=='object'||Array.isArray(value))return parseSingleGathering(value);
  const {timings,gatherings,...legacy}=value as Record<string,unknown>;
  const base=parseSingleGathering(legacy);
  if(!('timings' in value)&&!('gatherings' in value))return base;
  if(!Array.isArray(timings)||timings.length>3||new Set(timings).size!==timings.length||timings.some(t=>typeof t!=='string'||!Object.hasOwn(SOCIAL_TIMING_LABELS,t)))throw new TaskError('懇親会の開催区分が不正です');
  if(!Array.isArray(gatherings)||gatherings.length>100)throw new TaskError('懇親会の件数または入力形式が不正です');
  const ids=new Set<string>();
  const plans:SocialPlan[]=gatherings.map(value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('懇親会の入力形式が不正です');
    const body=value as Record<string,unknown>;
    if(Object.keys(body).some(key=>!['id','timing','start_at','end_at','venue','fee','budget','participants','attendees','start_date','end_date'].includes(key)))throw new TaskError('懇親会に変更できない項目が含まれています');
    if(typeof body.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(body.id)||ids.has(body.id))throw new TaskError('懇親会のIDが不正または重複しています');
    ids.add(body.id);
    if(typeof body.timing!=='string'||!Object.hasOwn(SOCIAL_TIMING_LABELS,body.timing))throw new TaskError('懇親会の開催区分が不正です');
    for(const key of ['budget','participants'])if(body[key]!==null&&(typeof body[key]!=='number'||!Number.isSafeInteger(body[key])||(body[key] as number)<0))throw new TaskError('懇親会の予算・参加人数は0以上の整数、または未定で入力してください');
    for(const key of ['start_date','end_date'] as const)if(body[key]!==undefined&&body[key]!==null)requireDate(body[key]);
    for(const [key,stamp] of [['start_date','start_at'],['end_date','end_at']] as const)if(body[key]!==undefined&&body[stamp]&&typeof body[stamp]==='string'&&body[stamp].slice(0,10)!==body[key])throw new TaskError('懇親会の日付と時刻が一致していません');
    const fields=parseSingleGathering({status:'HELD',start_at:body.start_at,end_at:body.end_at,venue:body.venue,fee:body.fee});
    return {id:body.id,timing:body.timing as SocialTiming,start_at:fields.start_at,end_at:fields.end_at,venue:fields.venue,fee:fields.fee,budget:body.budget as number|null,participants:body.participants as number|null,...(body.attendees===undefined?{}:{attendees:parseSocialAttendance(body.attendees)}),...(body.start_date===undefined?{}:{start_date:body.start_date as string|null}),...(body.end_date===undefined?{}:{end_date:body.end_date as string|null})};
  });
  if(timings.some(t=>!plans.some(p=>p.timing===t))||(base.status==='HELD'&&!timings.length))throw new TaskError('開催する懇親会の区分と内容を登録してください');
  return withSocialPlans(base,timings as SocialTiming[],plans);
}
export function mergeSocialGathering(current: SocialGathering, patch: unknown): SocialGathering {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TaskError('懇親会の入力形式が不正です');
  const data=patch as Record<string,unknown>;
  let merged={...current,...data};
  if(current.gatherings&&!('gatherings' in data)){
    const first=current.gatherings.find(p=>Array.isArray(merged.timings)&&merged.timings.includes(p.timing));
    if(first){const changes=Object.fromEntries(Object.entries(data).filter(([key])=>['start_at','end_at','venue','fee'].includes(key)));
      for(const [date,stamp] of [['start_date','start_at'],['end_date','end_at']] as const)if(first[date]!==undefined&&Object.hasOwn(changes,stamp))changes[date]=typeof changes[stamp]==='string'?(changes[stamp] as string).slice(0,10):null;
      merged={...merged,gatherings:current.gatherings.map(p=>p.id===first.id?{...p,...changes}:p)};
    }
  }
  return parseSocialGathering(merged);
}

// Stored as a Japanese local wall-clock time, independent of the browser's zone.
export function formatSocialDateTime(value: string | null): string {
  if (!value) return '未定';
  const [date, time] = value.split('T');
  return `${date.replace('-', '年').replace('-', '月')}日 ${time}（日本時間）`;
}

export function socialTotal(plan:Pick<SocialPlan,'participants'|'fee'>):string|null {return plan.participants===null||plan.fee===null?null:(BigInt(plan.participants)*BigInt(plan.fee)).toString();}
export function formatSocialPlanDateTime(plan:SocialPlan,end=false):string {const stamp=end?plan.end_at:plan.start_at,date=end?plan.end_date:plan.start_date;return stamp?formatSocialDateTime(stamp):date?`${date.replace('-','年').replace('-','月')}日（時刻未定）`:'未定';}
export function newSocialPlan(timing:SocialTiming,id:string,dates:string[],index=0):SocialPlan {const sorted=[...new Set(dates)].sort(),date=timing==='ON_DAY'?sorted[Math.min(index,sorted.length-1)]??null:null;return {...emptySocialPlan(timing,id),start_date:date,end_date:date};}
