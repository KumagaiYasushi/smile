'use client';
import {MEETING_METHOD_LABELS,MEETING_RESPONSE_LABELS} from '@/types/meeting';
import type {MeetingInput,MeetingDraft,MeetingMethod,MeetingResponse} from '@/types/meeting';
import {rosterColor} from '@/types/staff-roster';
import type {SocietyMember} from '@/types/society-member';
const input='mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm';
export default function MeetingFields({plans,members,disabled,onAdd,onChange,onRemove}:{plans:MeetingDraft[];members:SocietyMember[];disabled:boolean;onAdd:()=>void;onChange:(key:string,data:MeetingInput)=>void;onRemove:(key:string)=>void}) {
  return <section aria-label="打ち合わせの設定" className="space-y-4"><p className="text-sm text-slate-600">複数の日程と、それぞれの研究会講師・講師サポートメンバーの出欠を登録します。登録後も変更・追加できます。日程を変えると出欠を未選択へ戻します。</p>
    {plans.map((plan,index)=><fieldset key={plan.key} aria-label={`打ち合わせ ${index+1}`} disabled={disabled} className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4"><legend className="px-1 font-bold">打ち合わせ {index+1}</legend>
      <label className="block text-sm">打ち合わせ名<input aria-label="打ち合わせ名" required maxLength={200} value={plan.data.title} onChange={e=>onChange(plan.key,{...plan.data,title:e.target.value})} className={input}/></label>
      <div className="grid gap-3 sm:grid-cols-2">{(['date','time'] as const).map(field=><label key={field} className="block min-w-0 text-sm">{field==='date'?'打ち合わせ日':'開始時刻（任意・日本時間）'}<input aria-label={field==='date'?'打ち合わせ日':'開始時刻（任意・日本時間）'} type={field==='date'?'date':'time'} required={field==='date'&&!!plan.data.time} value={plan.data[field]??''} onChange={e=>onChange(plan.key,{...plan.data,[field]:e.target.value||null,...(field==='date'&&!e.target.value?{time:null}:{}),attendees:plan.data.attendees.map(p=>({...p,response:null}))})} className={input}/></label>)}</div>
      <label className="block text-sm">打ち合わせの開催方法<select aria-label="打ち合わせの開催方法" value={plan.data.method} onChange={e=>onChange(plan.key,{...plan.data,method:e.target.value as MeetingMethod})} className={input}>{Object.entries(MEETING_METHOD_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      {(['SOCIETY_LECTURER','SOCIETY_SUPPORT'] as const).map(role=><div key={role} className="space-y-2"><h3 className="font-bold">{role==='SOCIETY_LECTURER'?'研究会講師':'研究会講師サポートメンバー'}</h3>
        <ul className="grid gap-2 lg:grid-cols-2">{plan.data.attendees.filter(p=>p.role===role).map(person=>{
          const member=members.find(p=>p.id===person.member_id),name=person.name??member?.name??`名簿 #${person.member_id}`;
          return <li key={person.member_id} className={`min-w-0 rounded-xl border p-3 ${rosterColor(person.response??'UNANSWERED')}`}><fieldset aria-label={`${name}の打ち合わせ出欠`} className="min-w-0"><legend className="break-words font-bold">{name}</legend><div className="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-sm">{Object.entries(MEETING_RESPONSE_LABELS).map(([response,label])=><label key={response} className="flex items-center gap-1 py-1"><input type="radio" name={`meeting-${plan.key}-${person.member_id}`} value={response} checked={person.response===response} onChange={()=>onChange(plan.key,{...plan.data,attendees:plan.data.attendees.map(p=>p.member_id===person.member_id?{...p,response:response as MeetingResponse}:p)})}/>{label}</label>)}</div></fieldset></li>;
        })}</ul>
      </div>)}
      <button type="button" onClick={()=>{if(plan.id===undefined||confirm('この打ち合わせを削除対象にしますか？保存で確定します。'))onRemove(plan.key);}} className="text-sm text-red-700 underline">この打ち合わせを削除</button>
    </fieldset>)}
    <button type="button" disabled={disabled||plans.length>=100} onClick={onAdd} className="rounded-lg border border-sky-300 bg-white px-4 py-2 text-sm text-sky-800">＋ 打ち合わせを追加</button>
  </section>;
}
