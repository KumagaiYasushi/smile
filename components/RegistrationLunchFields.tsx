'use client';
import { emptyLunch,lunchCost,LUNCH_TARGET_LABELS,LUNCH_STATUS_LABELS } from '@/types/lunch';
import type { LunchInput,LunchTarget,LunchStatus } from '@/types/lunch';
import type { LunchDraft } from '@/types/event-registration';
const input='mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm';
export default function RegistrationLunchFields({dates,plans,disabled,onAdd,onChange,onRemove}:{
  dates:string[];plans:LunchDraft[];disabled:boolean;onAdd:(data:LunchInput)=>void;onChange:(key:string,data:LunchInput)=>void;onRemove:(key:string)=>void;
}) {
  return <section aria-label="登録画面の昼食手配" className="space-y-4">
    <p className="text-sm text-slate-600">登録時に分かる内容を入力できます。入力は任意で、登録後も追加・変更できます。イベントの保存ボタンでまとめて保存します。</p>
    {plans.map((plan,index)=>{
      const data=plan.data,change=(patch:Partial<LunchInput>)=>onChange(plan.key,{...data,...patch});
      let cost:number|null=null;try{cost=lunchCost(data);}catch{/* Validate on event save. */}
      return <fieldset key={plan.key} disabled={disabled} aria-label={`昼食手配 ${index+1}`} className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <legend className="px-1 font-bold">昼食手配 {index+1}{plan.id===undefined?'（新規）':''}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">昼食の日程<select aria-label="昼食の日程" value={data.date??''} onChange={e=>change({date:e.target.value||null})} className={input}><option value="">日程未定</option>{dates.map(date=><option key={date} value={date}>{date}</option>)}{data.date&&!dates.includes(data.date)&&<option value={data.date}>{data.date}（旧日程）</option>}</select></label>
          <label className="block text-sm">昼食を用意する対象<select aria-label="昼食を用意する対象" value={data.target} onChange={e=>change({target:e.target.value as LunchTarget})} className={input}>{Object.entries(LUNCH_TARGET_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <label className="block text-sm">対象の詳細（氏名・範囲など）<textarea aria-label="対象の詳細（氏名・範囲など）" maxLength={1000} rows={2} value={data.target_details} onChange={e=>change({target_details:e.target.value})} className={input}/></label>
        <div className="grid gap-3 sm:grid-cols-3">{([['quantity','人数・食数（人・食）'],['unit_price','1食あたりの費用（円）'],['additional_cost','送料などの追加費用（円）']] as const).map(([key,label])=><label key={key} className="block min-w-0 text-sm">{label}<input aria-label={label} type="number" min={0} step={1} max={Number.MAX_SAFE_INTEGER} value={data[key]??''} onChange={e=>change({[key]:e.target.value===''?null:Number(e.target.value)})} className={input}/></label>)}</div>
        <p className="text-sm">合計費用：{cost===null?'未定':`¥${cost.toLocaleString()}`}</p>
        <p className="text-xs text-slate-500">人数・費用の空欄は未定、0円は無料です。出欠から人数を自動計算しません。</p>
        <label className="block text-sm">お店・注文先<input aria-label="お店・注文先" maxLength={200} value={data.shop_name} onChange={e=>change({shop_name:e.target.value})} className={input}/></label>
        <label className="block text-sm">お店の連絡先・住所<textarea aria-label="お店の連絡先・住所" rows={2} maxLength={1000} value={data.shop_contact} onChange={e=>change({shop_contact:e.target.value})} className={input}/></label>
        <label className="block text-sm">メニュー<input aria-label="メニュー" maxLength={200} value={data.menu} onChange={e=>change({menu:e.target.value})} className={input}/></label>
        <label className="block text-sm">手配状態<select aria-label="手配状態" value={data.status} onChange={e=>change({status:e.target.value as LunchStatus})} className={input}>{Object.entries(LUNCH_STATUS_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block text-sm">備考<textarea aria-label="備考" maxLength={2000} rows={2} value={data.notes} onChange={e=>change({notes:e.target.value})} className={input}/></label>
        <button type="button" onClick={()=>{if(plan.id===undefined||confirm('この昼食手配を削除対象にしますか？イベントを保存したときに削除されます。'))onRemove(plan.key);}} className="text-sm text-red-700 underline">この昼食手配を削除</button>
      </fieldset>;
    })}
    <button type="button" disabled={disabled||plans.length>=100} onClick={()=>onAdd({...emptyLunch(),date:dates.length===1?dates[0]:null})} className="rounded-lg border border-sky-300 bg-white px-4 py-2 text-sm text-sky-800">＋ 昼食手配を追加</button>
  </section>;
}
