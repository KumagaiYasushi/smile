'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import GmailSettings from '@/components/GmailSettings';
import CalendarSettings from '@/components/CalendarSettings';
import ParticipantMailPanel from '@/components/ParticipantMailPanel';
import {apiJson} from '@/lib/client-api';
import type {Seminar} from '@/types/seminar';
import {EVENT_TYPE_LABELS} from '@/types/seminar';
export default function AutomationPage(){
 const [events,setEvents]=useState<Seminar[]>([]),[selected,setSelected]=useState(''),[loading,setLoading]=useState(true),[error,setError]=useState(''),[dirty,setDirty]=useState(false),[busy,setBusy]=useState(false);
 useEffect(()=>{const c=new AbortController();apiJson('/api/seminars',{signal:c.signal}).then(rows=>{if(!c.signal.aborted){setEvents(rows);setLoading(false);}}).catch(e=>{if(!c.signal.aborted){setError(e.message);setLoading(false);}});return()=>c.abort();},[]);
 useEffect(()=>{if(!dirty)return;const handler=(e:BeforeUnloadEvent)=>e.preventDefault();window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[dirty]);
 const event=events.find(e=>String(e.id)===selected);
 function change(value:string){if(dirty&&!confirm('編集中の設定・表示中のフォーム連携スクリプトを閉じて、別のイベントへ切り替えますか？'))return;setDirty(false);setBusy(false);setSelected(value);}
 return <div className="space-y-6 text-slate-900"><Link href="/settings" onClick={e=>{if(dirty&&!confirm('編集中の設定・表示中のフォーム連携スクリプトを閉じて戻りますか？'))e.preventDefault();}} className="text-sm font-medium text-sky-900 underline">← システム設定へ戻る</Link><h1 className="text-2xl font-bold">メール・カレンダー自動化設定</h1><p className="text-sm text-slate-700">Googleへの接続、申込受付・入金確認メール、カレンダーの自動登録をここで設定できます。メール用Gmailと研究会カレンダーは、それぞれ接続してください。</p>
 <nav aria-label="自動化設定の項目" className="flex flex-wrap gap-2">{[['#gmail','メール接続'],['#calendar','カレンダー接続・同期'],['#participant-mail','イベントごとの自動メール']].map(([href,label])=><a key={href} href={href} className="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-sm font-bold text-sky-950">{label}</a>)}</nav>
 <div className="grid min-w-0 items-start gap-4 2xl:grid-cols-2"><section id="gmail" aria-label="メール接続の設定" className="min-w-0 scroll-mt-4 rounded-2xl border border-slate-300 bg-white p-3 sm:p-5"><GmailSettings embedded/></section><section id="calendar" aria-label="カレンダー接続の設定" className="min-w-0 scroll-mt-4 rounded-2xl border border-slate-300 bg-white p-3 sm:p-5"><CalendarSettings embedded/></section></div>
 <section id="participant-mail" aria-label="イベントごとの自動メール設定" className="min-w-0 scroll-mt-4 space-y-4 rounded-2xl border border-slate-300 bg-slate-50 p-3 sm:p-5"><h2 className="text-xl font-bold">イベントごとの自動メール</h2><p className="text-sm text-slate-700">対象のイベントを選び、振込先・臨床相談フォーム・事前課題・Googleフォーム連携を設定します。自動送信はイベントごとに有効にしてください。</p>{error&&<p role="alert" className="text-red-800">{error}</p>}{loading?<p>イベントを読み込み中…</p>:!error&&<label className="block text-sm font-bold">設定するイベント<select aria-label="設定するイベント" value={selected} disabled={busy} onChange={e=>change(e.target.value)} className="mt-2 block w-full min-w-0 rounded-lg border border-slate-300 bg-white p-3 text-base"><option value="">イベントを選んでください</option>{events.map(e=><option key={e.id} value={e.id}>{e.name}（{EVENT_TYPE_LABELS[e.event_type]}）</option>)}</select></label>}{!loading&&!error&&!events.length&&<p className="text-sm">先に<Link href="/seminars/new" className="text-sky-900 underline">新規イベントを登録</Link>してください。</p>}{event&&<ParticipantMailPanel key={event.id} event={event} revision="automation" onDirtyChange={setDirty} onBusyChange={setBusy}/>}</section>
 <section aria-label="自動化する内容" className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50 p-4"><h2 className="text-lg font-bold">自動化する内容</h2><ul className="list-disc space-y-2 pl-5 text-sm"><li>申込受付：お礼・振込先・任意の臨床相談フォームをメール送信。課題はベーシックコースのみ。</li><li>入金確認：運営メンバーが入金済みを登録すると、領収書PDFを添付して送信。</li><li>予定の登録：イベント・確定した打ち合わせ・開催する懇親会をカレンダーへ同期。</li><li>タスクの依頼メール：タスク画面で文面・宛先を確認して送信。</li></ul><Link href="/mail-history" className="inline-block rounded-lg border border-sky-300 bg-white px-4 py-2 text-sm font-bold text-sky-950">メール送信履歴を確認</Link></section></div>;
}
