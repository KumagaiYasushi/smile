'use client';
import {useRef} from 'react';
import {lunchCost,lunchTargets,lunchQuantities,withLunchQuantities,LUNCH_TARGET_LABELS,LUNCH_STATUS_LABELS} from '@/types/lunch';
import type {LunchInput,LunchTarget,LunchStatus,LunchCounts} from '@/types/lunch';
export const LUNCH_QUANTITY_LABELS:Record<LunchTarget,string>={LECTURER:'講師のオーダー個数',EXTERNAL_LECTURER:'外来講師のオーダー個数',SUPPORT:'サポートメンバーのオーダー個数',PARTICIPANT:'参加者のオーダー個数',OTHER:'その他のオーダー個数'};
const input='mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm';
export default function LunchOrderFields({data,dates,isNew,onChange,getCounts}:{data:LunchInput;dates:string[];isNew:boolean;onChange:(data:LunchInput)=>void;getCounts:(date:string|null)=>LunchCounts}) {
  const manual=useRef(new Set<LunchTarget>());
  const targets=lunchTargets(data),quantities=lunchQuantities(data),counts=getCounts(data.date);
  const change=(patch:Partial<LunchInput>)=>onChange({...data,...patch});
  let cost:number|null=null;try{cost=lunchCost(data);}catch{/* Validate on save. */}
  function reflect(){manual.current.clear();onChange(withLunchQuantities(data,targets,getCounts(data.date)));}
  return <div className="space-y-4">
    <label className="block text-sm">昼食の日程<select aria-label="昼食の日程" value={data.date??''} onChange={e=>{
      const date=e.target.value||null,next={...data,date};
      if(isNew){const defaults=getCounts(date);onChange(withLunchQuantities(next,targets,Object.fromEntries(targets.map(target=>[target,manual.current.has(target)?quantities[target]??null:defaults[target]]))));}
      else onChange(next);
    }} className={input}><option value="">日程未定</option>{dates.map(date=><option key={date} value={date}>{date}</option>)}{data.date&&!dates.includes(data.date)&&<option value={data.date}>{data.date}（旧日程）</option>}</select></label>
    <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">用意する対象（複数選択可）</legend><div className="flex flex-wrap gap-x-4 gap-y-2">{Object.entries(LUNCH_TARGET_LABELS).map(([value,label])=>{
      const target=value as LunchTarget;
      return <label key={value} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={targets.includes(target)} onChange={e=>{
        const selected=e.target.checked?[...targets,target]:targets.filter(t=>t!==target);
        if(!e.target.checked)manual.current.delete(target);
        onChange(withLunchQuantities(data,selected,{...quantities,[target]:e.target.checked?counts[target]:quantities[target]??null}));
      }}/>{label}</label>;
    })}</div></fieldset>
    <div aria-label="登録人数の参考値" className="rounded-lg bg-white p-3 text-sm text-slate-600">出席登録の講師：{counts.LECTURER}名／サポート：{counts.SUPPORT}名<br/>参加者名簿：{counts.PARTICIPANT}名／外来講師：{counts.EXTERNAL_LECTURER}名</div>
    <div className="grid gap-3 sm:grid-cols-2">{targets.map(target=><label key={target} className="block min-w-0 text-sm">{LUNCH_QUANTITY_LABELS[target]}<input aria-label={LUNCH_QUANTITY_LABELS[target]} type="number" min={0} step={1} max={Number.MAX_SAFE_INTEGER} value={quantities[target]??''} onChange={e=>{manual.current.add(target);onChange(withLunchQuantities(data,targets,{...quantities,[target]:e.target.value===''?null:Number(e.target.value)}));}} className={input}/></label>)}</div>
    <p className="text-sm font-medium">オーダー合計：{data.quantity===null?'未定':`${data.quantity.toLocaleString()}個`}</p>
    <button type="button" onClick={reflect} className="text-sm text-sky-800 underline">出席登録・参加者数を個数に反映</button>
    <p className="text-xs text-slate-500">午前のみ・午後のみを含む出席人数を、追加時の初期値にします。参加者は名簿の登録人数（新規イベントは0名）、外来講師は「あり」の選択を使います。個数は自由に編集でき、出欠を変更しても手入力を上書きしません。</p>
    <label className="block text-sm">対象の詳細（氏名・範囲など）<textarea aria-label="対象の詳細（氏名・範囲など）" maxLength={1000} rows={2} value={data.target_details} onChange={e=>change({target_details:e.target.value})} className={input}/></label>
    <div className="grid gap-3 sm:grid-cols-2">{([['unit_price','1食あたりの費用（円）'],['additional_cost','送料などの追加費用（円）']] as const).map(([key,label])=><label key={key} className="block min-w-0 text-sm">{label}<input aria-label={label} type="number" min={0} step={1} max={Number.MAX_SAFE_INTEGER} value={data[key]??''} onChange={e=>change({[key]:e.target.value===''?null:Number(e.target.value)})} className={input}/></label>)}</div>
    <p className="text-sm">合計費用：{cost===null?'未定':`¥${cost.toLocaleString()}`}</p>
    <label className="block text-sm">お店・注文先<input aria-label="お店・注文先" maxLength={200} value={data.shop_name} onChange={e=>change({shop_name:e.target.value})} className={input}/></label>
    <label className="block text-sm">お店の連絡先・住所<textarea aria-label="お店の連絡先・住所" rows={2} maxLength={1000} value={data.shop_contact} onChange={e=>change({shop_contact:e.target.value})} className={input}/></label>
    <label className="block text-sm">メニュー<input aria-label="メニュー" maxLength={200} value={data.menu} onChange={e=>change({menu:e.target.value})} className={input}/></label>
    <label className="block text-sm">手配状態<select aria-label="手配状態" value={data.status} onChange={e=>change({status:e.target.value as LunchStatus})} className={input}>{Object.entries(LUNCH_STATUS_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
    <label className="block text-sm">備考<textarea aria-label="備考" maxLength={2000} rows={2} value={data.notes} onChange={e=>change({notes:e.target.value})} className={input}/></label>
  </div>;
}
