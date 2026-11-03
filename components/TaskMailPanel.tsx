'use client';
import {useRef,useState} from 'react';
import Link from 'next/link';
import {apiJson} from '@/lib/client-api';
import {TASK_MAIL_LABELS,parseTaskMail} from '@/types/task-message';
import type {TaskMail,TaskMailDraft,TaskMailPhase} from '@/types/task-message';
export default function TaskMailPanel({eventId,taskId,phase,onChange}:{eventId:string;taskId:number;phase?:TaskMailPhase;onChange:()=>Promise<void>}){
  const [open,setOpen]=useState(false),[mail,setMail]=useState<TaskMail|null>(null),[draft,setDraft]=useState<TaskMailDraft|null>(null),[connection,setConnection]=useState<{configured:boolean;connected:boolean;email:string|null}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const form=useRef<HTMLFormElement>(null),bodyRef=useRef<HTMLTextAreaElement>(null),endpoint=`/api/seminars/${eventId}/tasks/${taskId}/mail`;
  async function load(){const [result,gmail]=await Promise.all([apiJson(endpoint),apiJson('/api/gmail')]);setMail(result.mail);setDraft({to:result.mail.to,subject:result.mail.subject,body:result.mail.body});setConnection(gmail);return result.mail as TaskMail;}
  async function show(){if(open){setOpen(false);return;}setBusy(true);setError('');try{if(!mail)await load();setOpen(true);}catch(e){setError(e instanceof Error?e.message:'文面を取得できませんでした');}finally{setBusy(false);}}
  async function reload(){if(draft&&mail&&(draft.to!==mail.to||draft.subject!==mail.subject||draft.body!==mail.body)&&!confirm('編集中の文面を破棄して最新の内容を取得しますか？'))return;setBusy(true);setError('');setNotice('');try{await load();}catch(e){setError(e instanceof Error?e.message:'文面を再取得できませんでした');}finally{setBusy(false);}}
  async function rebuild(){
    if(!confirm('最新のタスク依頼文・期限・演者から件名と本文を作り直します。現在の編集内容は置き換わります。保存するまで保存済みの文面は変更されません。'))return;
    setBusy(true);setError('');setNotice('');
    try{const result=await apiJson(endpoint);if(!['DRAFT','FAILED'].includes(result.mail.phase))throw new Error('送信済み・送信処理中の文面は作り直せません');setMail(result.mail);setDraft({...result.template,to:draft?.to??result.mail.to});setNotice('タスク内の依頼文を反映しました。内容を確認して保存してください。');}
    catch(e){setError(e instanceof Error?e.message:'文面を作り直せませんでした');}finally{setBusy(false);}
  }
  async function copy(){setError('');setNotice('');try{const source=draft??await load();await navigator.clipboard.writeText(`宛先：${source.to}\n件名：${source.subject}\n\n${source.body}`);setNotice('文面をコピーしました');}catch{setOpen(true);setError('コピーできませんでした。文面を開き、本文を選択してコピーしてください。');setTimeout(()=>bodyRef.current?.select(),0);}}
  async function save(){if(!mail||!draft)return null;const fields=parseTaskMail(draft);const result=await apiJson(endpoint,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({...fields,version:mail.version})});setMail(result.mail);return result.mail as TaskMail;}
  async function saveDraft(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');setNotice('');try{await save();setNotice('文面を保存しました');await onChange();}catch(e){setError(e instanceof Error?e.message:'保存できませんでした');}finally{setBusy(false);}}
  async function send(){if(!draft||!form.current?.reportValidity())return;if(!draft.to){setError('宛先を入力してください。');return;}if(!confirm(`宛先：${draft.to}\n件名：${draft.subject}\n\nこの内容を接続中のGmailから送信しますか？`))return;setBusy(true);setError('');setNotice('');try{const saved=await save();if(!saved)return;const result=await apiJson(`${endpoint}/send`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:saved.version})});setMail(result.mail);setNotice('Gmailで送信しました');await onChange();}catch(e){setError(e instanceof Error?e.message:'送信結果を確認してください');try{await load();await onChange();}catch{/* Keep the entered draft and original error. */}}finally{setBusy(false);}}
  const currentPhase=phase??mail?.phase,editable=!currentPhase||['DRAFT','FAILED'].includes(currentPhase);
  const compose=draft?`https://mail.google.com/mail/?${new URLSearchParams({view:'cm',fs:'1',to:draft.to,su:draft.subject,body:draft.body})}`:'#';
  return <section aria-label="タスクのメール" className="mt-4 space-y-3 border-t pt-4">{currentPhase&&<p className="text-sm font-bold text-sky-800">送受信：{TASK_MAIL_LABELS[currentPhase]}</p>}
    <div className="flex flex-wrap gap-3"><button type="button" disabled={busy} aria-expanded={open} onClick={show} className="rounded-lg border px-3 py-2 text-sm">{open?'文面を閉じる':'文面を確認'}</button><button type="button" disabled={busy} onClick={copy} className="rounded-lg border px-3 py-2 text-sm">文面をコピー</button></div>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}{notice&&<p role="status" className="text-sm text-green-700">{notice}</p>}
    {open&&draft&&mail&&<form ref={form} onSubmit={saveDraft} className="space-y-3 rounded-lg bg-slate-50 p-3" aria-label="タスクのメール文面">
      <label className="block text-sm">宛先<input aria-label="メールの宛先" type="email" maxLength={254} value={draft.to} disabled={!editable||busy} onChange={e=>setDraft({...draft,to:e.target.value})} className="mt-1 block w-full rounded-lg border bg-white p-2"/></label>
      <label className="block text-sm">件名<input aria-label="メールの件名" required maxLength={200} value={draft.subject} disabled={!editable||busy} onChange={e=>setDraft({...draft,subject:e.target.value})} className="mt-1 block w-full rounded-lg border bg-white p-2"/></label>
      <label className="block text-sm">本文<textarea ref={bodyRef} aria-label="メールの本文" required rows={12} maxLength={20000} value={draft.body} readOnly={!editable} disabled={busy} onChange={e=>setDraft({...draft,body:e.target.value})} className="mt-1 block w-full rounded-lg border bg-white p-2"/></label>
      {mail.sender&&<p className="text-xs text-slate-600">送信元：{mail.sender}{connection?.email!==mail.sender?'（返信確認にはこのGmailを接続してください）':''}</p>}
      <p className="text-xs text-slate-600">この画面の「Gmailで送信」で送ったメールを自動記録します。相手からの返信で「受信済み」になります。資料の内容・不足分は別途確認してください。</p>
      {editable&&<button type="button" disabled={busy} onClick={rebuild} className="mr-4 text-sm text-sky-800 underline">タスクの依頼文から作り直す</button>}
      <button type="button" disabled={busy} onClick={reload} className="text-sm text-sky-800 underline">文面を再取得</button>
      <div className="flex flex-wrap gap-3">{editable&&<><button disabled={busy} className="rounded-lg border bg-white px-3 py-2 text-sm">文面を保存</button><button type="button" disabled={busy||!connection?.connected||!connection?.configured} onClick={send} className="rounded-lg bg-sky-800 px-3 py-2 text-sm text-white disabled:opacity-50">Gmailで送信</button></>}
      <a href={compose} target="_blank" rel="noopener noreferrer" className="py-2 text-sm text-sky-800 underline">Gmailで文面を開く（自動記録なし）</a></div>
      <Link href="/gmail" className="block text-sm text-sky-800 underline">{connection?.connected?`Gmail接続中：${connection.email}`:'Gmail連携を設定する'}</Link>
    </form>}
  </section>;
}
