'use client';
import { useEffect,useState } from 'react';
import { apiJson } from '@/lib/client-api';
import { SOCIETY_ROLE_LABELS } from '@/types/society-member';
import type { SocietyMember,SocietyRole } from '@/types/society-member';
const input='mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2';
export default function SocietyMembersPage() {
  const [members,setMembers]=useState<SocietyMember[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
  const [draft,setDraft]=useState<{id?:number;name:string;role:SocietyRole;active:boolean;version?:number}|null>(null);
  useEffect(()=>{const controller=new AbortController();apiJson('/api/society-members',{signal:controller.signal}).then(data=>setMembers(data.members)).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return ()=>controller.abort();},[]);
  async function reload(){setBusy(true);setError('');try{setMembers((await apiJson('/api/society-members')).members);}catch(e){setError(e instanceof Error?e.message:'取得できませんでした');}finally{setBusy(false);}}
  async function save(e:React.FormEvent){e.preventDefault();if(!draft)return;setBusy(true);setError('');setNotice('');try{
    const {id,...body}=draft;
    const member:SocietyMember=await apiJson(`/api/society-members${id?`/${id}`:''}`,{method:id?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    setMembers(current=>[...current.filter(p=>p.id!==member.id),member]);setDraft(null);setNotice('保存しました');
  }catch(e){setError(e instanceof Error?e.message:'保存できませんでした');}finally{setBusy(false);}}
  return <div className="space-y-5"><h1 className="text-2xl font-bold">研究会講師・サポート名簿</h1>
    <p className="text-sm text-slate-600">イベントや出欠予定で選択する氏名を登録します。ログイン用アカウントとは別の名簿です。氏名を変更しても登録済みイベントの記録は保持します。</p>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}{notice&&<p role="status" className="rounded-lg bg-green-50 p-3">{notice}</p>}
    <div className="flex flex-wrap gap-3"><button disabled={busy||!!draft} onClick={()=>{setError('');setDraft({name:'',role:'SOCIETY_LECTURER',active:true});}} className="rounded-lg bg-sky-800 px-4 py-2 text-white">＋ 名簿に追加</button><button disabled={busy||!!draft} onClick={reload} className="rounded-lg border px-4 py-2">最新情報を取得</button></div>
    {draft&&<form aria-label="研究会名簿の編集" onSubmit={save} className="space-y-4 rounded-xl border bg-white p-5"><fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm">氏名<input aria-label="氏名" required maxLength={200} value={draft.name} onChange={e=>setDraft({...draft,name:e.target.value})} className={input}/></label>
      <label className="block text-sm">区分<select aria-label="区分" value={draft.role} onChange={e=>setDraft({...draft,role:e.target.value as SocietyRole})} className={input}>{Object.entries(SOCIETY_ROLE_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.active} onChange={e=>setDraft({...draft,active:e.target.checked})}/>選択候補として利用する</label>
      <div className="flex gap-3"><button className="rounded-lg bg-sky-800 px-4 py-2 text-white">保存する</button><button type="button" onClick={()=>{setDraft(null);setError('');}} className="rounded-lg border px-4 py-2">キャンセル</button></div></fieldset></form>}
    {loading?<p>読み込み中…</p>:members.length===0?<p className="text-slate-500">名簿が空です。「名簿に追加」から登録してください。</p>:<div className="grid gap-3 sm:grid-cols-2">{members.map(p=><article key={p.id} className="space-y-2 rounded-xl border bg-white p-4"><h2 className="break-words font-bold">{p.name}</h2><p className="text-sm">{SOCIETY_ROLE_LABELS[p.role]}{!p.active&&'（利用停止）'}</p><button disabled={busy||!!draft} onClick={()=>{setError('');setDraft(p);}} className="text-sm text-sky-800 underline">編集</button></article>)}</div>}
  </div>;
}
