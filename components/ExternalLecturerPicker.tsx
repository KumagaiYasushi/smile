'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {apiJson} from '@/lib/client-api';
import type {ExternalLecturer,ExternalSelection} from '@/types/external-lecturer';
export default function ExternalLecturerPicker({value,onChange}:{value:ExternalSelection;onChange:(value:ExternalSelection)=>void}) {
  const [people,setPeople]=useState<ExternalLecturer[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();apiJson('/api/external-lecturers',{signal:controller.signal}).then(data=>setPeople(data.lecturers)).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[]);
  async function reload(){setLoading(true);setError('');try{setPeople((await apiJson('/api/external-lecturers')).lecturers);}catch(e){setError(e instanceof Error?e.message:'取得できませんでした');}finally{setLoading(false);}}
  return <div className="space-y-3 rounded-xl bg-sky-50 p-4 text-sm"><label className="block font-medium">外来講師名・勤務施設名<select aria-label="外来講師名・勤務施設名" required value={value.id??(value.name?'saved':'')} onChange={e=>{const p=people.find(p=>p.id===Number(e.target.value));if(p)onChange({status:'YES',id:p.id,name:p.name,facility:p.facility});else if(!e.target.value)onChange({status:'YES',id:null,name:'',facility:''});}} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2"><option value="">{loading?'読み込み中…':'リストから選択してください'}</option>{value.name&&<option value={value.id??'saved'}>{value.name} / {value.facility||'勤務施設未設定'}（保存済み）</option>}{people.filter(p=>p.active&&p.id!==value.id).map(p=><option key={p.id} value={p.id}>{p.name} / {p.facility}</option>)}</select></label>
    {value.name&&<p className="break-words">外来講師：{value.name}<br/>勤務施設：{value.facility||'未設定'}</p>}{error&&<p role="alert" className="text-red-700">外来講師リストを取得できませんでした。再取得してください。</p>}
    <div className="flex flex-wrap gap-3"><Link href="/external-lecturers" target="_blank" rel="noopener noreferrer" className="text-sky-800 underline">外来講師リストを管理（別タブ）</Link><button type="button" disabled={loading} onClick={reload} className="text-sky-800 underline">外来講師リストを再取得</button></div>
  </div>;
}
