'use client';
import {use,useState} from 'react';
import Link from 'next/link';
import {useEventRoles} from '@/components/useEventRoles';
import EventRoleFields from '@/components/EventRoleFields';
import {apiJson} from '@/lib/client-api';
import {roleAssignmentSubmission} from '@/types/event-roles';
export default function EventRolesPage({params}:{params:Promise<{id:string}>}){
  const {id}=use(params),roles=useEventRoles(Number(id));const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function save(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');setNotice('');try{roles.apply(await apiJson(`/api/seminars/${id}/roles`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(roleAssignmentSubmission(roles.data,roles.data.members))}));setNotice('役割担当を保存しました');}catch(e){setError(e instanceof Error?e.message:'役割担当を保存できませんでした');}finally{setBusy(false);}}
  return <div className="space-y-5"><Link href={`/seminars/${id}`} className="text-sm text-sky-800 underline">← イベント詳細へ</Link><h1 className="text-2xl font-bold">役割担当</h1>{roles.loading&&<p>担当・名簿を読み込み中…</p>}{(error||roles.error)&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error||roles.error}</p>}{notice&&<p role="status" className="rounded-lg bg-green-50 p-3 text-green-700">{notice}</p>}
    <button type="button" disabled={busy||roles.loading} onClick={async()=>{setError('');setNotice('');await roles.reload();}} className="text-sm text-sky-800 underline">担当・名簿を再取得</button>
    <form onSubmit={save} aria-label="イベントの役割担当" className="space-y-5"><EventRoleFields data={roles.data} disabled={busy||roles.loading||!!roles.error} onToggle={roles.toggle}/><button disabled={busy||roles.loading||!!roles.error} className="rounded-lg bg-sky-800 px-5 py-2 text-white disabled:opacity-50">{busy?'保存中…':'役割担当を保存'}</button></form>
  </div>;
}
