'use client';
import { useEffect,useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/client-api';
import type { SocietyMember,SocietyRole } from '@/types/society-member';
export default function SocietyMemberPicker({role,value,onChange,label,required=false}:{role:SocietyRole;value:string;onChange:(name:string)=>void;label:string;required?:boolean}) {
  const [members,setMembers]=useState<SocietyMember[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  useEffect(()=>{const controller=new AbortController();apiJson('/api/society-members',{signal:controller.signal}).then(data=>setMembers(data.members)).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return ()=>controller.abort();},[]);
  async function reload(){setLoading(true);setError('');try{setMembers((await apiJson('/api/society-members')).members);}catch(e){setError(e instanceof Error?e.message:'取得できませんでした');}finally{setLoading(false);}}
  const options=members.filter(p=>p.role===role&&p.active);
  return <div className="min-w-0 space-y-2 text-sm"><label className="block">{label}<select aria-label={label} required={required} value={value} onChange={e=>onChange(e.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2"><option value="">{loading?'名簿を読み込み中…':'名簿から選択してください'}</option>{value&&!options.some(p=>p.name===value)&&<option value={value}>{value}（保存済み）</option>}{options.map(p=><option key={p.id} value={p.name}>{p.name}</option>)}</select></label>
    {error&&<p role="alert" className="text-red-700">名簿を取得できませんでした。再取得してください。</p>}
    <div className="flex flex-wrap gap-3"><Link href="/society-members" target="_blank" rel="noopener noreferrer" className="text-sky-800 underline">名簿を管理（別タブ）</Link><button type="button" disabled={loading} onClick={reload} className="text-sky-800 underline">名簿を再取得</button></div>
  </div>;
}
