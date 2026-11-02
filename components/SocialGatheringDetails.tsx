import {normalizeSocialGathering,SOCIAL_STATUS_LABELS,SOCIAL_TIMING_LABELS,formatSocialDateTime} from '@/types/social-gathering';
import {SOCIAL_ATTENDANCE_ROLES} from '@/types/social-attendance';
import {rosterColor} from '@/types/staff-roster';
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
      {!!plan.attendees?.length&&<div className="space-y-2 border-t pt-3"><h4 className="font-bold">懇親会の出欠</h4><p className="text-sm">出席 {plan.attendees.filter(p=>p.response==='ATTENDING').length}名 ／ 欠席 {plan.attendees.filter(p=>p.response==='ABSENT').length}名 ／ 未選択 {plan.attendees.filter(p=>p.response===null).length}名</p><ul className="grid gap-2 sm:grid-cols-2">{plan.attendees.map(p=><li key={p.key} className={`rounded-lg border p-2 text-sm ${rosterColor(p.response??'UNANSWERED')}`}><span className="break-words font-bold">{p.name}</span>（{SOCIAL_ATTENDANCE_ROLES[p.role]}）・{p.response==='ATTENDING'?'出席':p.response==='ABSENT'?'欠席':'未選択'}</li>)}</ul></div>}
    </section>):<p className="text-sm text-slate-500">懇親会の区分・詳細は未設定です。</p>}
  </div>;
}
