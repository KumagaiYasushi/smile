'use client';
import {useEffect,useState} from 'react';
import {apiJson} from '@/lib/client-api';
import {SPEAKER_ROLES} from '@/types/speaker';
import type {Speaker} from '@/types/speaker';
import type {ExternalLecturer} from '@/types/external-lecturer';
import type {SocietyMember} from '@/types/society-member';
export default function SpeakerFields({value,onChange,dates=[],multiple=false}:{value:Speaker[];onChange:(people:Speaker[])=>void;dates?:string[];multiple?:boolean}){
  const [external,setExternal]=useState<ExternalLecturer[]>([]),[members,setMembers]=useState<SocietyMember[]>([]),[error,setError]=useState('');
  function load(){return Promise.all([apiJson('/api/external-lecturers'),apiJson('/api/society-members')]).then(([a,b])=>{setExternal(a.lecturers);setMembers(b.members);setError('');}).catch(e=>setError(e instanceof Error?e.message:'名簿を取得できませんでした'));}
  useEffect(()=>{void load();},[]);
  function update(index:number,patch:Partial<Speaker>){onChange(value.map((p,i)=>i===index?{...p,...patch}:p));}
  const byDate=multiple||dates.length>1||value.some(person=>person.date!==undefined);
  const dayGroups=[...dates,...new Set(value.flatMap(person=>person.date&&!dates.includes(person.date)?[person.date]:[]))];
  function add(date?:string){onChange([...value,{role:'SOCIETY_LECTURER',id:null,name:'',facility:'',theme:'',...(date?{date}:{})}]);}
  function speakerCard(p:Speaker,i:number){return <fieldset key={i} aria-label={`演者 ${i+1}`} className="space-y-3 rounded-lg border p-3"><legend>演者 {i+1}</legend>
      {(byDate||p.date)&&<label className="block text-sm">登壇日<select aria-label="登壇日" value={p.date??''} onChange={e=>update(i,{date:e.target.value||undefined})} className="block w-full rounded border p-2"><option value="">全開催日共通</option>{p.date&&!dates.includes(p.date)&&<option value={p.date}>{p.date}（現在の開催日にありません）</option>}{dates.map(date=><option key={date} value={date}>{date}</option>)}</select>{p.date&&!dates.includes(p.date)&&<span className="text-xs text-amber-800">開催日が変更されています。登壇日を確認してください。</span>}</label>}
      <label className="block text-sm">演者区分<select aria-label="演者区分" value={p.role} onChange={e=>update(i,{role:e.target.value as Speaker['role'],id:null,name:'',facility:'',payment:undefined})} className="block w-full rounded border p-2">{Object.entries(SPEAKER_ROLES).map(([role,label])=><option key={role} value={role}>{label}</option>)}</select></label>
      <label className="block text-sm">名簿から選択<select aria-label="名簿から選択" required={p.role!=='EXTERNAL_LECTURER'&& !p.name} value={p.id??''} onChange={e=>{const list=p.role==='EXTERNAL_LECTURER'?external:members.filter(x=>x.role===p.role);const person=list.find(x=>x.id===Number(e.target.value));update(i,person?{id:person.id,name:person.name,facility:'facility'in person?person.facility:''}:{id:null,name:'',facility:''});}} className="block w-full rounded border p-2"><option value="">{p.role==='EXTERNAL_LECTURER'?'新しい外部講師を入力':'選択してください'}</option>{p.id!==null&&<option value={p.id}>{p.name}（保存済み）</option>}{(p.role==='EXTERNAL_LECTURER'?external:members.filter(x=>x.role===p.role)).filter(x=>x.active&&x.id!==p.id).map(x=><option key={x.id} value={x.id}>{x.name}{'facility'in x?` / ${x.facility}`:''}</option>)}</select></label>
      {p.id===null&&<label className="block text-sm">氏名<input required value={p.name} readOnly={p.role!=='EXTERNAL_LECTURER'} maxLength={200} onChange={e=>update(i,{name:e.target.value})} className="block w-full rounded border p-2"/></label>}
      {p.role==='EXTERNAL_LECTURER'&&<label className="block text-sm">勤務施設名<input required value={p.facility} readOnly={p.id!==null} maxLength={300} onChange={e=>update(i,{facility:e.target.value})} className="block w-full rounded border p-2"/></label>}
      {p.role==='EXTERNAL_LECTURER'&&<fieldset className="grid gap-3 sm:grid-cols-2"><legend className="text-sm font-medium">この外部講師への支払い</legend>{([['travel','お車代'],['honorarium','謝礼']] as const).map(([key,label])=><label key={key} className="block text-sm">{label}（円）<input aria-label={`${label}（円）`} type="number" min={0} step={1} max={Number.MAX_SAFE_INTEGER} value={p.payment?.[key]??''} onChange={e=>update(i,{payment:{travel:p.payment?.travel??null,honorarium:p.payment?.honorarium??null,[key]:e.target.value===''?null:Number(e.target.value)}})} className="block w-full rounded border p-2"/></label>)}<p className="text-xs text-slate-500 sm:col-span-2">空欄は未定、0は0円として保存します。</p></fieldset>}
      <label className="block text-sm">テーマ<textarea value={p.theme} maxLength={2000} onChange={e=>update(i,{theme:e.target.value})} className="block w-full rounded border p-2"/></label>
      <button type="button" onClick={()=>onChange(value.filter((_,n)=>n!==i))} className="text-sm text-red-700">演者 {i+1} を削除</button>
    </fieldset>;}
  return <div className="space-y-4"><p className="text-sm text-slate-600">外部講師・研究会講師・研究会サポートメンバーから複数名を登録できます。新しい外部講師の氏名・勤務施設はイベント保存時に名簿へ保存します。</p>
    {byDate&&<p className="text-sm text-slate-600">開催日ごとの「この日に演者を追加」から登録してください。同じ方でも日ごとにテーマ・お車代・謝礼を設定できます。</p>}
    {error&&<p role="alert" className="text-red-700">{error}</p>}<button type="button" onClick={load} className="text-sm text-sky-800 underline">演者名簿を再取得</button>
    {byDate?<>
      {!dates.length&&<p className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">基本情報に開催日を入力すると、日付ごとの演者登録欄が表示されます。日程未定の場合は共通の欄に登録できます。</p>}
      {dayGroups.map((date,index)=><section key={date} aria-label={`${date}の演者登録`} className={`space-y-3 rounded-xl border p-4 ${dates.includes(date)?'border-sky-200 bg-sky-50/50':'border-amber-200 bg-amber-50/50'}`}>
        <h3 className="font-bold text-sky-900">{dates.includes(date)?`第${index+1}回 ／ ${date}`:`${date}（旧日程・日付を確認）`}</h3>
        <p className="text-sm text-slate-600">登録済み：{value.filter(p=>p.date===date).length}名</p>
        {value.map((p,i)=>p.date===date?speakerCard(p,i):null)}
        {dates.includes(date)&&<button type="button" aria-label={`${date}に演者を追加`} onClick={()=>add(date)} className="rounded-lg border border-sky-700 bg-white px-3 py-2 text-sm text-sky-900">＋ この日に演者を追加</button>}
      </section>)}
      <section aria-label="全開催日共通の演者登録" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 className="font-bold text-slate-700">全開催日共通・日程未定</h3><p className="text-sm text-slate-600">すべての開催日で共通の方や、登壇日が未定の方はこちらに登録します。</p>{value.map((p,i)=>!p.date?speakerCard(p,i):null)}<button type="button" onClick={()=>add()} className="rounded-lg border bg-white px-3 py-2 text-sm">全開催日共通の演者を追加</button></section>
    </>:<>{value.map(speakerCard)}<button type="button" onClick={()=>add()} className="rounded border px-3 py-2 text-sm">演者を追加</button></>}
  </div>;
}
