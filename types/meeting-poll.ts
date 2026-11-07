import {TaskError} from './task.ts';
import {requireDate} from './task-template.ts';
import {isTenMinuteTime} from './time-input.ts';
import type {SocietyMember} from './society-member.ts';
export const POLL_RESPONSE_LABELS={YES:'○ 参加可能',MAYBE:'△ 調整が必要',NO:'× 参加不可'} as const;
export type PollResponse=keyof typeof POLL_RESPONSE_LABELS;
export type PollCandidateInput={id?:number;date:string;start:string;end:string|null};
export type PollCandidate=Required<PollCandidateInput>&{revision:number};
export type PollAnswer={candidate_id:number;member_id:number;response:PollResponse|null;version:number};
export type MeetingPollData={title:string;version:number;candidates:PollCandidate[];members:SocietyMember[];answers:PollAnswer[]};
export function parsePollSettings(value:unknown):{title:string;version:number;candidates:PollCandidateInput[]}{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('候補日時の入力形式が不正です');
  const b=value as Record<string,unknown>;
  if(Object.keys(b).some(k=>!['title','version','candidates'].includes(k)))throw new TaskError('候補日時に変更できない項目が含まれています');
  if(typeof b.title!=='string'||!b.title.trim()||b.title.trim().length>200)throw new TaskError('日程調整の名前は1〜200文字で入力してください');
  if(typeof b.version!=='number'||!Number.isSafeInteger(b.version)||b.version<0)throw new TaskError('日程調整の版が不正です');
  if(!Array.isArray(b.candidates)||b.candidates.length>30)throw new TaskError('候補日時は30件以内で設定してください');
  const ids=new Set<number>(),times=new Set<string>();
  const candidates=b.candidates.map((v):PollCandidateInput=>{
    if(!v||typeof v!=='object'||Array.isArray(v))throw new TaskError('候補日時の入力形式が不正です');
    const c=v as Record<string,unknown>;
    if(Object.keys(c).some(k=>!['id','date','start','end'].includes(k)))throw new TaskError('候補日時に変更できない項目が含まれています');
    if(c.id!==undefined&&(typeof c.id!=='number'||!Number.isSafeInteger(c.id)||c.id<1||ids.has(c.id)))throw new TaskError('候補日時のIDが不正または重複しています');
    if(c.id!==undefined)ids.add(c.id as number);
    const date=requireDate(c.date);
    if(!isTenMinuteTime(c.start)||(c.end!==null&&!isTenMinuteTime(c.end)))throw new TaskError('候補の開始・終了時刻は10分単位で設定してください');
    if(c.end!==null&&(c.end as string)<=c.start)throw new TaskError('終了時刻は開始時刻より後にしてください');
    const key=`${date}/${c.start}/${c.end??''}`;if(times.has(key))throw new TaskError('同じ候補日時が重複しています');times.add(key);
    return {id:c.id as number|undefined,date,start:c.start,end:c.end as string|null};
  });
  return {title:b.title.trim(),version:b.version,candidates};
}

export function summarizePoll(data:MeetingPollData){
  const active=new Set(data.members.filter(m=>m.active).map(m=>m.id));
  const scores=data.candidates.map(candidate=>{
    const answers=data.answers.filter(a=>a.candidate_id===candidate.id&&active.has(a.member_id));
    const yes=answers.filter(a=>a.response==='YES').length,maybe=answers.filter(a=>a.response==='MAYBE').length,no=answers.filter(a=>a.response==='NO').length;
    return {candidate,yes,maybe,no,unanswered:active.size-yes-maybe-no};
  });
  const eligible=scores.filter(s=>s.yes+s.maybe>0);
  const maxYes=Math.max(0,...eligible.map(s=>s.yes));
  const maxMaybe=Math.max(0,...eligible.filter(s=>s.yes===maxYes).map(s=>s.maybe));
  const recommended=eligible.filter(s=>s.yes===maxYes&&s.maybe===maxMaybe);
  return {scores,recommended};
}
