'use client';
import TimeSelect from '@/components/TimeSelect';
import SocialAttendanceFields from '@/components/SocialAttendanceFields';
import type {SocietyMember} from '@/types/society-member';
import type {ExternalSelection} from '@/types/external-lecturer';
import {newSocialPlan,socialTotal,normalizeSocialGathering,withSocialPlans,SOCIAL_TIMING_LABELS,SOCIAL_STATUS_LABELS} from '@/types/social-gathering';
import type {SocialGathering,SocialTiming,SocialPlan,SocialStatus} from '@/types/social-gathering';
const input='mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm';
export default function SocialGatheringEditor({value,onChange,members,external,dates}:{value:SocialGathering;onChange:(value:SocialGathering)=>void;members:SocietyMember[];external:ExternalSelection;dates:string[]}) {
  const data=normalizeSocialGathering(value);
  const add=(timing:SocialTiming)=>newSocialPlan(timing,crypto.randomUUID(),dates,data.gatherings.filter(p=>p.timing===timing).length);
  function update(plan:SocialPlan,patch:Partial<SocialPlan>){onChange(withSocialPlans(data,data.timings,data.gatherings.map(p=>p.id===plan.id?{...p,...patch}:p)));}
  function select(timing:SocialTiming,checked:boolean){
    const timings=checked?[...data.timings,timing]:data.timings.filter(t=>t!==timing);
    const plans=checked&&!data.gatherings.some(p=>p.timing===timing)?[...data.gatherings,add(timing)]:data.gatherings;
    onChange(withSocialPlans({...data,status:timings.length?'HELD':'NOT_HELD'},timings,plans));
  }
  return <div className="space-y-4">
    <label className="block text-sm">懇親会の開催<select aria-label="懇親会の開催" value={data.status} onChange={e=>{
      const status=e.target.value as SocialStatus;
      if(status==='HELD'&&!data.timings.length){const plans=data.gatherings.some(p=>p.timing==='ON_DAY')?data.gatherings:[...data.gatherings,add('ON_DAY')];onChange(withSocialPlans({...data,status},['ON_DAY'],plans));}
      else onChange({...data,status});
    }} className={input}>{Object.entries(SOCIAL_STATUS_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <fieldset><legend className="mb-2 text-sm font-medium">懇親会の開催区分（複数選択可）</legend><div className="flex flex-wrap gap-4">{Object.entries(SOCIAL_TIMING_LABELS).map(([key,label])=><label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.timings.includes(key as SocialTiming)} onChange={e=>select(key as SocialTiming,e.target.checked)}/>{label}</label>)}</div></fieldset>
    <p className="text-xs text-slate-500">合計金額は参加人数×参加費で自動計算します。日時・人数・参加費は未定でも保存できます。開催日の懇親会はイベントの日付を初期表示し、変更できます。区分の選択を外しても内容を保持し、選び直すと再表示します。</p>
    {Object.entries(SOCIAL_TIMING_LABELS).filter(([key])=>data.timings.includes(key as SocialTiming)).map(([key,label])=><div key={key} className="space-y-3">
      {data.gatherings.filter(p=>p.timing===key).map((plan,index)=><fieldset aria-label={`${label}の懇親会 ${index+1}`} key={plan.id} className="min-w-0 space-y-3 rounded-xl border bg-slate-50 p-4"><legend className="px-1 font-bold">{label}の懇親会 {index+1}</legend>
        <div className="grid gap-3 sm:grid-cols-2">{(['start','end'] as const).map(part=>{
          const dateKey=part==='start'?'start_date':'end_date',stampKey=part==='start'?'start_at':'end_at';
          const date=plan[dateKey]??plan[stampKey]?.slice(0,10)??(part==='end'?plan.start_date??plan.start_at?.slice(0,10):'')??'',time=plan[stampKey]?.slice(11,16)??'';
          const reset=(patch:Partial<SocialPlan>)=>update(plan,{...patch,attendees:(plan.attendees??[]).map(p=>({...p,response:null}))});
          return <div key={part} className="space-y-2"><label className="block text-sm">{part==='start'?'懇親会の開催日':'懇親会の終了日'}<input aria-label={part==='start'?'懇親会の開催日':'懇親会の終了日'} type="date" required={!!time} value={date} onChange={e=>{const next=e.target.value||null;reset({[dateKey]:next,[stampKey]:next&&time?`${next}T${time}`:null,...(part==='start'&&(!(plan.end_date??plan.end_at?.slice(0,10))||(plan.end_date??plan.end_at?.slice(0,10))===date)?{end_date:next,end_at:next&&plan.end_at?`${next}T${plan.end_at.slice(11,16)}`:null}:{} )});}} className={input}/></label><label className="block text-sm">{part==='start'?'開始時刻（10分刻み）':'終了時刻（10分刻み）'}<TimeSelect label={part==='start'?'懇親会の開始時刻':'懇親会の終了時刻'} minutes={10} disabled={!date} minimum={part==='end'&&date===(plan.start_date??plan.start_at?.slice(0,10))?plan.start_at?.slice(11,16):undefined} value={time} onChange={next=>reset({[dateKey]:date||null,[stampKey]:next&&date?`${date}T${next}`:null})}/></label>{!date&&<p className="text-xs text-slate-500">日付を選んでから時刻を設定してください。</p>}</div>;
        })}</div>
        <label className="block text-sm">懇親会のお店・場所・住所<textarea aria-label="懇親会の場所・住所" rows={2} maxLength={2000} value={plan.venue} onChange={e=>update(plan,{venue:e.target.value})} className={input}/></label>
        <div className="grid gap-3 sm:grid-cols-2">{([['participants','懇親会の参加人数（人）'],['fee','懇親会の参加費（1人あたり・円）']] as const).map(([field,text])=><label key={field} className="block min-w-0 text-sm">{text}<input aria-label={text} type="number" min={0} step={1} max={Number.MAX_SAFE_INTEGER} value={plan[field]??''} onChange={e=>update(plan,{[field]:e.target.value===''?null:Number(e.target.value)})} className={input}/></label>)}</div>
        <p className="rounded-lg bg-white p-3 text-sm font-bold">合計金額：{socialTotal(plan)===null?'未定':`¥${BigInt(socialTotal(plan)!).toLocaleString('ja-JP')}`}</p>
        <SocialAttendanceFields planId={plan.id} value={plan.attendees??[]} members={members} external={external} onChange={attendees=>update(plan,{attendees})}/>
        <button type="button" onClick={()=>{if(!confirm('この懇親会の記録を削除対象にしますか？イベントの保存で確定します。'))return;const plans=data.gatherings.filter(p=>p.id!==plan.id),timings=data.timings.filter(t=>plans.some(p=>p.timing===t));onChange(withSocialPlans({...data,status:timings.length?data.status:'NOT_HELD'},timings,plans));}} className="text-sm text-red-700 underline">この懇親会を削除</button>
      </fieldset>)}
      <button type="button" disabled={data.gatherings.length>=100} onClick={()=>onChange(withSocialPlans(data,data.timings,[...data.gatherings,add(key as SocialTiming)]))} className="text-sm text-sky-800 underline">＋ {label}の懇親会を追加</button>
    </div>)}
  </div>;
}
