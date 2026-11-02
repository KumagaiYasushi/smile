import {normalizeSocialGathering,SOCIAL_STATUS_LABELS,SOCIAL_TIMING_LABELS,formatSocialDateTime} from '@/types/social-gathering';
import type {SocialGathering,SocialTiming} from '@/types/social-gathering';
export default function SocialGatheringDetails({value}:{value:SocialGathering}) {
  const data=normalizeSocialGathering(value);
  const plans=Object.keys(SOCIAL_TIMING_LABELS).flatMap(timing=>data.timings.includes(timing as SocialTiming)?data.gatherings.filter(plan=>plan.timing===timing).map((plan,index)=>({...plan,number:index+1})):[]);
  return <div className="space-y-4"><p>開催：{SOCIAL_STATUS_LABELS[data.status]}</p>
    {data.status==='NOT_HELD'?<p className="text-sm text-slate-500">入力済みの懇親会情報は編集画面で確認できます。</p>:plans.length?plans.map(plan=><section key={plan.id} aria-label={`懇親会 ${plan.id}`} className="space-y-3 rounded-xl border border-slate-200 p-4">
      <h3 className="font-bold">{SOCIAL_TIMING_LABELS[plan.timing]}の懇親会 {plan.number}</h3>
      <dl className="space-y-2 text-sm">{[
        ['開始日時',formatSocialDateTime(plan.start_at)],['終了日時',formatSocialDateTime(plan.end_at)],['お店・場所',plan.venue||'未定'],
        ['予算総額',plan.budget===null?'未定':`¥${plan.budget.toLocaleString()}`],['参加人数',plan.participants===null?'未定':`${plan.participants.toLocaleString()}名`],
        ['参加費',plan.fee===null?'未定':plan.fee===0?'無料（0円）':`¥${plan.fee.toLocaleString()}／人`],
      ].map(([label,text])=><div key={label}><dt className="text-slate-500">{label}</dt><dd className="whitespace-pre-wrap break-words">{text}</dd></div>)}</dl>
    </section>):<p className="text-sm text-slate-500">懇親会の区分・詳細は未設定です。</p>}
  </div>;
}
