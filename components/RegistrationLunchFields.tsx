'use client';
import {defaultLunch} from '@/types/lunch';
import type {LunchInput,LunchCounts} from '@/types/lunch';
import type {LunchDraft} from '@/types/event-registration';
import LunchOrderFields from '@/components/LunchOrderFields';
export default function RegistrationLunchFields({dates,plans,disabled,onAdd,onChange,onRemove,getCounts}:{dates:string[];plans:LunchDraft[];disabled:boolean;onAdd:(data:LunchInput)=>void;onChange:(key:string,data:LunchInput)=>void;onRemove:(key:string)=>void;getCounts:(date:string|null)=>LunchCounts}) {
  return <section aria-label="登録画面の昼食手配" className="space-y-4">
    <p className="text-sm text-slate-600">対象を複数選択して、対象別のオーダー個数を入力できます。入力は任意で、登録時・登録後の両方で追加・変更できます。</p>
    {plans.map((plan,index)=><fieldset key={plan.key} disabled={disabled} aria-label={`昼食手配 ${index+1}`} className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <legend className="px-1 font-bold">昼食手配 {index+1}{plan.id===undefined?'（新規）':''}</legend>
      <LunchOrderFields data={plan.data} dates={dates} isNew={plan.id===undefined} getCounts={getCounts} onChange={data=>onChange(plan.key,data)}/>
      <button type="button" onClick={()=>{if(plan.id===undefined||confirm('この昼食手配を削除対象にしますか？イベントを保存したときに削除されます。'))onRemove(plan.key);}} className="text-sm text-red-700 underline">この昼食手配を削除</button>
    </fieldset>)}
    <button type="button" disabled={disabled||plans.length>=100} onClick={()=>{const date=dates.length===1?dates[0]:null;onAdd(defaultLunch(getCounts(date),date));}} className="rounded-lg border border-sky-300 bg-white px-4 py-2 text-sm text-sky-800">＋ 昼食手配を追加</button>
  </section>;
}
