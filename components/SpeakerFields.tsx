'use client';
import {useEffect,useState} from 'react';
import {apiJson} from '@/lib/client-api';
import {SPEAKER_ROLES} from '@/types/speaker';
import type {Speaker} from '@/types/speaker';
import type {ExternalLecturer} from '@/types/external-lecturer';
import type {SocietyMember} from '@/types/society-member';
export default function SpeakerFields({value,onChange}:{value:Speaker[];onChange:(people:Speaker[])=>void}){
  const [external,setExternal]=useState<ExternalLecturer[]>([]),[members,setMembers]=useState<SocietyMember[]>([]),[error,setError]=useState(''),[role,setRole]=useState<Speaker['role']>('SOCIETY_LECTURER');
  function load(){return Promise.all([apiJson('/api/external-lecturers'),apiJson('/api/society-members')]).then(([a,b])=>{setExternal(a.lecturers);setMembers(b.members);setError('');}).catch(e=>setError(e instanceof Error?e.message:'名簿を取得できませんでした'));}
  useEffect(()=>{void load();},[]);
  function update(index:number,patch:Partial<Speaker>){onChange(value.map((p,i)=>i===index?{...p,...patch}:p));}
  const directory=(role==='EXTERNAL_LECTURER'?external:members.filter(p=>p.role===role)).filter(p=>p.active);
  function toggle(person:typeof directory[number],checked:boolean){
    if(checked){if(value.some(p=>p.role===role&&p.id===person.id))return;onChange([...value,{role,id:person.id,name:person.name,facility:'facility'in person?person.facility:'',theme:''}]);}
    else onChange(value.filter(p=>!(p.role===role&&p.id===person.id)));
  }
  return <div className="space-y-4"><p className="text-sm text-slate-600">演者を複数登録し、それぞれのテーマを設定できます。新しい外部講師の氏名・勤務施設はイベント保存時に名簿へ保存します。</p>
    {error&&<p role="alert" className="text-red-700">{error}</p>}<button type="button" onClick={load} className="text-sm text-sky-800 underline">演者名簿を再取得</button>
    <fieldset className="space-y-3 rounded-lg border bg-slate-50 p-3"><legend className="font-medium">名簿から演者を複数選択</legend>
      <label className="block text-sm">選択する演者区分<select value={role} onChange={e=>setRole(e.target.value as Speaker['role'])} className="mt-1 block w-full rounded border bg-white p-2">{Object.entries(SPEAKER_ROLES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <div className="max-h-64 space-y-2 overflow-y-auto">{directory.map(person=><label key={person.id} className="flex items-start gap-2 rounded border bg-white p-2 text-sm"><input type="checkbox" className="mt-1" checked={value.some(p=>p.role===role&&p.id===person.id)} onChange={e=>toggle(person,e.target.checked)}/><span>{person.name}{'facility'in person?` / ${person.facility}`:''}</span></label>)}</div>
      {!directory.length&&<p className="text-sm text-slate-500">名簿を読み込むか、名簿に演者を登録してください。</p>}
      <p className="text-sm">登録する演者：{value.length}名。選択した演者のテーマは下で編集できます。</p>
    </fieldset>
    {value.map((p,i)=><fieldset key={i} className="space-y-3 rounded-lg border p-3"><legend>演者 {i+1}</legend>
      <label className="block text-sm">演者区分<select value={p.role} onChange={e=>update(i,{role:e.target.value as Speaker['role'],id:null,name:'',facility:''})} className="block w-full rounded border p-2">{Object.entries(SPEAKER_ROLES).map(([role,label])=><option key={role} value={role}>{label}</option>)}</select></label>
      <label className="block text-sm">名簿から選択<select required={p.role!=='EXTERNAL_LECTURER'&& !p.name} value={p.id??''} onChange={e=>{const list=p.role==='EXTERNAL_LECTURER'?external:members.filter(x=>x.role===p.role);const person=list.find(x=>x.id===Number(e.target.value));update(i,person?{id:person.id,name:person.name,facility:'facility'in person?person.facility:''}:{id:null,name:'',facility:''});}} className="block w-full rounded border p-2"><option value="">{p.role==='EXTERNAL_LECTURER'?'新しい外部講師を入力':'選択してください'}</option>{p.id!==null&&<option value={p.id}>{p.name}（保存済み）</option>}{(p.role==='EXTERNAL_LECTURER'?external:members.filter(x=>x.role===p.role)).filter(x=>x.active&&x.id!==p.id).map(x=><option key={x.id} value={x.id}>{x.name}{'facility'in x?` / ${x.facility}`:''}</option>)}</select></label>
      {p.id===null&&<label className="block text-sm">氏名<input required value={p.name} readOnly={p.role!=='EXTERNAL_LECTURER'} maxLength={200} onChange={e=>update(i,{name:e.target.value})} className="block w-full rounded border p-2"/></label>}
      {p.role==='EXTERNAL_LECTURER'&&<label className="block text-sm">勤務施設名<input required value={p.facility} readOnly={p.id!==null} maxLength={300} onChange={e=>update(i,{facility:e.target.value})} className="block w-full rounded border p-2"/></label>}
      <label className="block text-sm">テーマ<textarea value={p.theme} maxLength={2000} onChange={e=>update(i,{theme:e.target.value})} className="block w-full rounded border p-2"/></label>
      <button type="button" onClick={()=>onChange(value.filter((_,n)=>n!==i))} className="text-sm text-red-700">演者 {i+1} を削除</button>
    </fieldset>)}
    <button type="button" onClick={()=>onChange([...value,{role:'SOCIETY_LECTURER',id:null,name:'',facility:'',theme:''}])} className="rounded border px-3 py-2 text-sm">演者を追加</button>
  </div>;
}
