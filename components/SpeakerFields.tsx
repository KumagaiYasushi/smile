'use client';
import {useEffect,useState} from 'react';
import {apiJson} from '@/lib/client-api';
import {SPEAKER_ROLES} from '@/types/speaker';
import type {Speaker} from '@/types/speaker';
import type {ExternalLecturer} from '@/types/external-lecturer';
import type {SocietyMember} from '@/types/society-member';
export default function SpeakerFields({value,onChange,dates=[],multiple=false}:{value:Speaker[];onChange:(people:Speaker[])=>void;dates?:string[];multiple?:boolean}){
  const [external,setExternal]=useState<ExternalLecturer[]>([]),[members,setMembers]=useState<SocietyMember[]>([]),[error,setError]=useState(''),[expanded,setExpanded]=useState<number|null>(null);
  function load(){return Promise.all([apiJson('/api/external-lecturers'),apiJson('/api/society-members')]).then(([a,b])=>{setExternal(a.lecturers);setMembers(b.members);setError('');}).catch(e=>setError(e instanceof Error?e.message:'名簿を取得できませんでした'));}
  useEffect(()=>{void load();},[]);
  function update(index:number,patch:Partial<Speaker>){onChange(value.map((p,i)=>i===index?{...p,...patch}:p));}
  const byDate=multiple||dates.length>1||value.some(person=>person.date!==undefined);
  const dayGroups=[...dates,...new Set(value.flatMap(person=>person.date&&!dates.includes(person.date)?[person.date]:[]))];
  function add(date?:string){setExpanded(value.length);onChange([...value,{role:'SOCIETY_LECTURER',id:null,name:'',facility:'',theme:'',...(date?{date}:{})}]);}
  function speakerCard(p:Speaker,i:number){return <fieldset key={i} aria-label={`演者 ${i+1}`} className="min-w-0 rounded-xl border border-slate-200 bg-white"><legend className="sr-only">演者 {i+1}</legend><details data-speaker-editor open={expanded===i}><summary onClick={e=>{e.preventDefault();setExpanded(expanded===i?null:i);}} className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-xl p-3"><span className="min-w-0 space-y-1"><span className="block break-words font-medium text-slate-800">{p.name||'演者を選択してください'}</span><span className="block text-xs text-sky-800">{SPEAKER_ROLES[p.role]}</span><span className="block truncate text-sm text-slate-500">{p.theme||'テーマ未設定'}</span></span><span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">{expanded===i?'閉じる':'編集'}</span></summary><div className="space-y-4 border-t border-slate-100 p-3 sm:p-4">
      {(byDate||p.date)&&<label className="block text-sm">登壇日<select aria-label="登壇日" required={byDate&&dates.length>0} value={p.date??''} onChange={e=>update(i,{date:e.target.value||undefined})} className="block w-full rounded border p-2"><option value="" disabled>登壇日を選択してください</option>{p.date&&!dates.includes(p.date)&&<option value={p.date}>{p.date}（現在の開催日にありません）</option>}{dates.map(date=><option key={date} value={date}>{date}</option>)}</select>{p.date&&!dates.includes(p.date)&&<span className="text-xs text-amber-800">開催日が変更されています。登壇日を確認してください。</span>}</label>}
      <div className="grid gap-3 sm:grid-cols-2">
      <label className="block text-sm">演者区分<select aria-label="演者区分" value={p.role} onChange={e=>update(i,{role:e.target.value as Speaker['role'],id:null,name:'',facility:'',payment:undefined})} className="block w-full rounded border p-2">{Object.entries(SPEAKER_ROLES).map(([role,label])=><option key={role} value={role}>{label}</option>)}</select></label>
      <label className="block text-sm">名簿から選択<select aria-label="名簿から選択" required={p.role!=='EXTERNAL_LECTURER'&& !p.name} value={p.id??''} onChange={e=>{const list=p.role==='EXTERNAL_LECTURER'?external:members.filter(x=>x.role===p.role);const person=list.find(x=>x.id===Number(e.target.value));update(i,person?{id:person.id,name:person.name,facility:'facility'in person?person.facility:''}:{id:null,name:'',facility:''});}} className="block w-full rounded border p-2"><option value="">{p.role==='EXTERNAL_LECTURER'?'新しい外部講師を入力':'選択してください'}</option>{p.id!==null&&<option value={p.id}>{p.name}（保存済み）</option>}{(p.role==='EXTERNAL_LECTURER'?external:members.filter(x=>x.role===p.role)).filter(x=>x.active&&x.id!==p.id).map(x=><option key={x.id} value={x.id}>{x.name}{'facility'in x?` / ${x.facility}`:''}</option>)}</select></label>
      </div>
      {p.id===null&&<label className="block text-sm">氏名<input required value={p.name} readOnly={p.role!=='EXTERNAL_LECTURER'} maxLength={200} onChange={e=>update(i,{name:e.target.value})} className="block w-full rounded border p-2"/></label>}
      {p.role==='EXTERNAL_LECTURER'&&<label className="block text-sm">勤務施設名<input required value={p.facility} readOnly={p.id!==null} maxLength={300} onChange={e=>update(i,{facility:e.target.value})} className="block w-full rounded border p-2"/></label>}
      {p.role==='EXTERNAL_LECTURER'&&<fieldset className="grid gap-3 sm:grid-cols-2"><legend className="text-sm font-medium">この外部講師への支払い</legend>{([['travel','お車代'],['honorarium','謝礼']] as const).map(([key,label])=><label key={key} className="block text-sm">{label}（円）<input aria-label={`${label}（円）`} type="number" min={0} step={1} max={Number.MAX_SAFE_INTEGER} value={p.payment?.[key]??''} onChange={e=>update(i,{payment:{travel:p.payment?.travel??null,honorarium:p.payment?.honorarium??null,[key]:e.target.value===''?null:Number(e.target.value)}})} className="block w-full rounded border p-2"/></label>)}<p className="text-xs text-slate-500 sm:col-span-2">空欄は未定、0は0円として保存します。</p></fieldset>}
      <label className="block text-sm">テーマ<textarea rows={3} value={p.theme} maxLength={2000} onChange={e=>update(i,{theme:e.target.value})} className="block w-full rounded border p-2"/></label>
      <div className="flex items-center justify-between border-t border-slate-100 pt-3"><button type="button" onClick={()=>setExpanded(null)} className="rounded-lg border px-3 py-2 text-sm text-slate-700">入力を閉じる</button><button type="button" onClick={()=>{setExpanded(null);onChange(value.filter((_,n)=>n!==i));}} className="text-sm text-red-700">演者 {i+1} を削除</button></div>
    </div></details></fieldset>;}
  return <div className="space-y-4"><p className="text-sm text-slate-600">外部講師・研究会講師・研究会サポートメンバーから複数名を登録できます。新しい外部講師の氏名・勤務施設はイベント保存時に名簿へ保存します。</p>
    {byDate&&<p className="text-sm text-slate-600">開催日ごとに演者を追加します。登録内容は名前とテーマで一覧表示し、「編集」で入力欄を開きます。</p>}
    {error&&<p role="alert" className="text-red-700">{error}</p>}<button type="button" onClick={load} className="text-sm text-sky-800 underline">演者名簿を再取得</button>
    {byDate?<>
      {!dates.length&&<p className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">基本情報に開催日を入力してから、その日の演者を登録してください。</p>}
      {dayGroups.map((date,index)=><section key={date} aria-label={`${date}の演者登録`} className={`space-y-3 rounded-xl border p-3 sm:p-4 ${dates.includes(date)?'border-sky-200 bg-sky-50/50':'border-amber-200 bg-amber-50/50'}`}>
        <h3 className="font-bold text-sky-900">{dates.includes(date)?`第${index+1}回 ／ ${date}`:`${date}（旧日程・日付を確認）`}</h3>
        <p className="text-sm text-slate-600">登録済み：{value.filter(p=>p.date===date).length}名</p>
        {value.map((p,i)=>p.date===date?speakerCard(p,i):null)}
        {dates.includes(date)&&<button type="button" aria-label={`${date}に演者を追加`} onClick={()=>add(date)} className="rounded-lg border border-sky-700 bg-white px-3 py-2 text-sm text-sky-900">＋ この日に演者を追加</button>}
      </section>)}
      {value.some(person=>!person.date)&&<section aria-label="登壇日の指定が必要な演者" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4"><h3 className="font-medium text-amber-900">登録済み演者の登壇日を指定してください</h3><p className="text-sm text-amber-900">以前の登録内容を表示しています。各演者の「編集」を開き、登壇日を選択してください。</p>{value.map((p,i)=>!p.date?speakerCard(p,i):null)}</section>}
    </>:<>{value.map(speakerCard)}<button type="button" onClick={()=>add()} className="rounded border px-3 py-2 text-sm">演者を追加</button></>}
  </div>;
}
