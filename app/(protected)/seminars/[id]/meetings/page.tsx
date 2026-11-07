'use client';
import {use,useState} from 'react';
import Link from 'next/link';
import {apiJson} from '@/lib/client-api';
import {useMeetingDraft} from '@/components/useMeetingDraft';
import MeetingFields from '@/components/MeetingFields';
import MeetingPoll from '@/components/MeetingPoll';
export default function MeetingsPage({params}:{params:Promise<{id:string}>}) {
  const {id}=use(params),draft=useMeetingDraft(Number(id));const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  async function save(event:React.FormEvent){event.preventDefault();setBusy(true);setError('');setMessage('');try{draft.apply(await apiJson(`/api/seminars/${id}/meetings`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({changes:draft.payload()})}));setMessage('打ち合わせを保存しました');}catch(e){setError(e instanceof Error?e.message:'保存できませんでした');}finally{setBusy(false);}}
  const unsaved=(()=>{try{return draft.payload().length>0;}catch{return true;}})();
  return <div className="space-y-5"><Link href={`/seminars/${id}`} className="text-sm text-sky-800 underline">← イベント詳細へ</Link><h1 className="text-2xl font-bold">打ち合わせ</h1><MeetingPoll key={id} eventId={Number(id)} disabledDecision={draft.loading||unsaved} onDecided={()=>{void draft.reload();}}/><h2 className="text-xl font-bold">打ち合わせの登録（確定した日程）</h2>{draft.loading&&<p>読み込み中…</p>}{(error||draft.error)&&<p role="alert" className="text-red-700">{error||draft.error}</p>}{message&&<p role="status" className="text-green-700">{message}</p>}<button disabled={busy||draft.loading} onClick={draft.reload} className="text-sm text-sky-800 underline">打ち合わせを再取得</button>
    <form onSubmit={save} className="space-y-5"><MeetingFields plans={draft.plans} members={draft.members} disabled={busy||draft.loading} onAdd={draft.add} onChange={draft.update} onRemove={draft.remove}/><button disabled={busy||draft.loading||!!draft.error} className="rounded-lg bg-sky-800 px-5 py-2 text-white">{busy?'保存中…':'打ち合わせを保存'}</button></form></div>;
}
