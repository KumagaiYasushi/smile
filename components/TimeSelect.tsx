'use client';
import {useEffect,useRef} from 'react';
import {isMinuteTime} from '@/types/time-input';
export default function TimeSelect({value,onChange,label,required=false,disabled=false,minimum,minutes=10}:{value:string;onChange:(value:string)=>void;label:string;required?:boolean;disabled?:boolean;minimum?:string;minutes?:5|10}){
  const select=useRef<HTMLSelectElement>(null);
  const oldValue=!!value&&!isMinuteTime(value,minutes);
  useEffect(()=>{select.current?.setCustomValidity(value&&!isMinuteTime(value,minutes)?`時刻は${minutes}分単位で選択してください。`:value&&minimum&&value<minimum?'開始時刻以降を選択してください。':'');},[value,minimum,minutes]);
  return <select ref={select} aria-label={label} title={`${minutes}分刻みで選択`} data-minute-step={minutes} required={required} disabled={disabled} value={value} onChange={e=>{e.currentTarget.setCustomValidity('');onChange(e.target.value);}} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 sm:text-sm"><option value="">未設定</option>{oldValue&&<option value={value} disabled>{value}（保存済み・要修正）</option>}{Array.from({length:1440/minutes},(_,i)=>{const time=`${String(Math.floor(i*minutes/60)).padStart(2,'0')}:${String(i*minutes%60).padStart(2,'0')}`;return <option key={time} value={time} disabled={!!minimum&&time<minimum}>{time}</option>;})}</select>;
}
