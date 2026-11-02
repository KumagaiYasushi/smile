'use client';
export default function TimeSelect({value,onChange,minutes,label,required=false,disabled=false,minimum}:{value:string;onChange:(value:string)=>void;minutes:5|10;label:string;required?:boolean;disabled?:boolean;minimum?:string}){
  const options=Array.from({length:1440/minutes},(_,index)=>{const n=index*minutes;return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;});
  return <select aria-label={label} required={required} disabled={disabled} value={value} onChange={e=>onChange(e.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"><option value="">時刻未定</option>{value&&!options.includes(value)&&<option value={value}>{value}（保存済み）</option>}{options.filter(time=>!minimum||time>=minimum).map(time=><option key={time} value={time}>{time}</option>)}</select>;
}
