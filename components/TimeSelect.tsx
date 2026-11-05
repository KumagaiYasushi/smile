'use client';
import {useEffect,useRef} from 'react';
import {isTenMinuteTime} from '@/types/time-input';
function timeError(value:string,minimum?:string){
  if(!value)return '';
  if(!isTenMinuteTime(value))return '時刻は10分単位で入力してください。';
  return minimum&&value<minimum?'開始時刻以降を入力してください。':'';
}
export default function TimeSelect({value,onChange,label,required=false,disabled=false,minimum}:{value:string;onChange:(value:string)=>void;label:string;required?:boolean;disabled?:boolean;minimum?:string}){
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{input.current?.setCustomValidity(timeError(value,minimum));},[value,minimum]);
  return <input ref={input} aria-label={label} aria-description="10分単位で入力" type="time" required={required} disabled={disabled} step={600} min="00:00" value={value} onChange={e=>{e.currentTarget.setCustomValidity(timeError(e.target.value,minimum));onChange(e.target.value);}} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base sm:text-sm"/>;
}
