'use client';
import {use,useEffect,useState} from 'react';
import Link from 'next/link';
import {apiJson} from '@/lib/client-api';
import {outlineSections,outlineFileName} from '@/types/event-outline';
import type {EventOutline} from '@/types/event-outline';
export default function EventOutlinePage({params}:{params:Promise<{id:string}>}){
  const {id}=use(params);const [data,setData]=useState<EventOutline|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{const controller=new AbortController();apiJson(`/api/seminars/${id}/outline`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setData(result);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[id]);
  async function download(){if(!data)return;setBusy(true);setError('');try{
    const response=await fetch(`/api/seminars/${id}/outline/pdf`,{cache:'no-store'});
    if(response.status===401){window.location.assign('/login');return;}
    if(!response.ok){const result=await response.json();throw new Error(result.error??'PDFを作成できませんでした');}
    const blob=await response.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=outlineFileName(data.name);document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch(e){setError(e instanceof Error?e.message:'PDFを作成できませんでした');}finally{setBusy(false);}}
  return <div className="space-y-5"><div className="print:hidden space-y-3"><Link href={`/seminars/${id}`} className="text-sm text-sky-800 underline">← イベント詳細へ</Link><h1 className="text-2xl font-bold">開催要項PDF</h1><p className="text-sm text-slate-600">WEBページ管理者へ渡す内容を確認して、PDFをダウンロードしてください。修正はイベント編集画面で行えます。</p><div className="flex flex-wrap gap-3"><button disabled={!data||busy} onClick={download} className="rounded-lg bg-sky-800 px-5 py-2 text-white disabled:opacity-50">{busy?'PDFを作成中…':'PDFをダウンロード'}</button><Link href={`/seminars/${id}/edit`} className="rounded-lg border px-4 py-2 text-sm">開催情報を編集</Link></div></div>
    {error&&<p role="alert" className="print:hidden rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}{!data&&!error&&<p>読み込み中…</p>}
    {data&&<article aria-label="開催要項プレビュー" className="mx-auto max-w-[210mm] space-y-6 rounded-xl border border-slate-200 bg-white p-5 sm:p-10"><header className="space-y-3 border-b border-slate-300 pb-6"><p className="text-sm text-sky-800">{data.organization}</p><h2 className="text-center text-2xl font-bold">開催要項</h2><p className="break-words text-center text-xl font-bold">{data.name}</p></header>{outlineSections(data).map((section,index)=><section key={`${index}-${section.title}`} className="space-y-2"><h3 className="font-bold text-sky-800">{section.title}</h3><p className="whitespace-pre-wrap break-words text-sm leading-7">{section.text}</p></section>)}</article>}
  </div>;
}
