'use client';
import {EVENT_COLORS} from '@/types/event-colors';
import EventTypeLegend from '@/components/EventTypeLegend';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { eventDeliveryLabel,eventMethodForDate } from '@/types/event-options';
import {eventSessionName} from '@/types/event-session';
import {apiJson} from '@/lib/client-api';
import LinkedText from '@/components/LinkedText';
import {ENTRY_KIND_LABELS} from '@/types/event-list';
import type {EventListEntry} from '@/types/event-list';
import { formatEventDate } from '@/types/event-schedule';
import { Seminar, CHECKLIST_ITEMS, EventType, EVENT_TYPE_LABELS } from '@/types/seminar';

function EntryDate({entry}:{entry:EventListEntry}){return <><span className="block">{entry.date?.replaceAll('-','/')??'日程未定'}</span>{entry.start&&<span className="mt-1 block text-xs tabular-nums">{entry.start}{entry.end?`〜${entry.end_date&&entry.end_date!==entry.date?entry.end_date.replaceAll('-','/')+' ':''}${entry.end}`:''}</span>}</>;}
function ViewIcon({rows}:{rows:boolean}){return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">{rows?<><path d="M8 5h13M8 12h13M8 19h13"/><path d="M3 5h1M3 12h1M3 19h1"/></>:<><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>}</svg>;}
function ChecklistProgress({ seminar }: { seminar: Seminar }) {
  const completed = CHECKLIST_ITEMS.filter((item) => seminar[item.key]).length;
  const total = CHECKLIST_ITEMS.length;
  const pct = Math.round((completed / total) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span>進捗</span>
        <span>{completed}/{total}</span>
      </div>
      <div className="w-full bg-slate-300 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${pct === 100 ? 'bg-green-700' : 'bg-sky-700'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}


export default function HomePage() {
  const [seminars, setSeminars] = useState<Seminar[]>([]);
  const [entries,setEntries]=useState<EventListEntry[]>([]),[error,setError]=useState(''),[kind,setKind]=useState<keyof typeof ENTRY_KIND_LABELS|'ALL'>('ALL');
  const [view,setView]=useState<'cards'|'rows'>(()=>{try{return typeof window!=='undefined'&&localStorage.getItem('smile-event-list-view')==='rows'?'rows':'cards';}catch{return 'cards';}});
  function changeView(value:'cards'|'rows'){setView(value);try{localStorage.setItem('smile-event-list-view',value);}catch{/* The toggle still works if browser storage is unavailable. */}}
  const [loading, setLoading] = useState(true);
  const [eventType, setEventType] = useState<EventType | 'ALL'>('ALL');

  useEffect(()=>{const c=new AbortController();apiJson('/api/event-list',{signal:c.signal}).then(data=>{if(!c.signal.aborted){setSeminars(data.seminars);setEntries(data.entries);setLoading(false);}}).catch(e=>{if(!c.signal.aborted){setError(e.message);setLoading(false);}});return()=>c.abort();},[]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">読み込み中...</div>
    );
  }

  const visible=entries.filter(entry=>(eventType==='ALL'||entry.event_type===eventType)&&(kind==='ALL'||entry.kind===kind));

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 border-b-2 border-slate-300 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900">イベント一覧</h1><p className="mt-1 text-sm font-medium text-slate-700">{seminars.length===0?'イベントはまだ登録されていません':`イベント ${seminars.length}件・予定 ${entries.length}件`}</p></div>
        <Link href="/seminars/new" className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-orange-800 bg-orange-700 px-5 py-3 text-base font-bold text-white shadow-md transition-colors hover:bg-orange-800 focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-orange-700 sm:w-auto"><span aria-hidden="true" className="text-2xl leading-none">＋</span>新規イベントを作成</Link>
      </div>

      {error&&<p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-red-800">{error} ページを再読み込みしてください。</p>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><EventTypeLegend/><div role="group" aria-label="一覧の表示形式" className="flex gap-1 rounded-xl border border-slate-300 bg-slate-100 p-1">{(['cards','rows'] as const).map(value=><button key={value} type="button" aria-label={value==='cards'?'詳細カード表示':'シンプルな行表示'} title={value==='cards'?'詳細カード表示':'シンプルな行表示'} aria-pressed={view===value} onClick={()=>changeView(value)} className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${view===value?'bg-sky-900 text-white shadow':'text-slate-800 hover:bg-white'}`}><ViewIcon rows={value==='rows'}/>{value==='cards'?'詳細':'行'}</button>)}</div></div>
      <div className="mb-6 rounded-xl border border-slate-300 bg-slate-100 p-4">
        <label htmlFor="event-type-filter" className="block text-sm font-medium text-slate-700 mb-2">イベント種別で絞り込み</label>
        <select id="event-type-filter" value={eventType} onChange={(e) => setEventType(e.target.value as EventType | 'ALL')} className="w-full sm:w-64 border border-slate-300 rounded-lg bg-white px-3 py-2 text-sm">
          <option value="ALL">すべて</option>
          {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <label className="mt-3 block text-sm font-medium text-slate-700">予定の種類<select aria-label="予定の種類" value={kind} onChange={e=>setKind(e.target.value as typeof kind)} className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm sm:w-64"><option value="ALL">すべての予定</option>{Object.entries(ENTRY_KIND_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><p className="text-sm text-slate-700 mt-2" aria-live="polite">{visible.length} 件を表示</p>
      </div>

      {error?null:seminars.length === 0 ? (
        <div className="bg-sky-50 rounded-2xl border-2 border-sky-300 p-6 sm:p-12 text-center">
          <div className="text-5xl mb-4">📋</div>
          <h2 className="text-xl font-bold text-slate-700 mb-2">セミナーを登録しましょう</h2>
          <p className="text-slate-500 text-sm mb-6">上の「新規イベントを作成」ボタンから登録できます</p>
        </div>
      ) : visible.length === 0 ? (
        <p className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">条件に一致する予定はありません</p>
      ) : view==='rows'?(
        <div className="rounded-xl border border-slate-300 bg-slate-50 p-1 sm:p-2"><table aria-label="予定の行一覧" className="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-2 text-left text-sm"><thead className="bg-slate-800 text-white"><tr><th scope="col" className="w-[28%] rounded-l-lg p-2 sm:w-[24%] sm:p-3">日付</th><th scope="col" className="w-[40%] p-2 sm:w-[43%] sm:p-3">イベント名</th><th scope="col" className="rounded-r-lg p-2 sm:p-3">会場</th></tr></thead><tbody>{visible.map(entry=><tr key={entry.key} data-entry-kind={entry.kind} data-event-type={entry.event_type} className={`drop-shadow-sm ${EVENT_COLORS[entry.event_type].card}`}><td className="break-words rounded-l-xl border-y border-l-4 border-inherit bg-inherit p-2 align-top text-xs sm:p-3 sm:text-sm"><EntryDate entry={entry}/></td><td className="break-words border-y border-inherit bg-inherit p-2 align-top [overflow-wrap:anywhere] sm:p-3"><span className="mb-1 inline-block rounded-full bg-white px-2 py-0.5 text-xs font-bold">{ENTRY_KIND_LABELS[entry.kind]}</span><Link href={entry.href} className="block font-bold text-sky-950 underline">{entry.name}</Link>{entry.kind!=='EVENT'&&<span className="mt-1 block text-xs text-slate-700">{entry.parent_name}</span>}</td><td className="break-words rounded-r-xl border-y border-r border-inherit bg-inherit p-2 align-top text-xs [overflow-wrap:anywhere] sm:p-3 sm:text-sm"><LinkedText text={entry.venue}/></td></tr>)}</tbody></table></div>
      ) : (
        <div aria-label="登録済みイベント" className="grid min-w-0 grid-cols-1 gap-5 rounded-2xl border border-slate-300 bg-slate-100 p-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {visible.map(entry => {const seminar=seminars.find(s=>s.id===entry.seminar_id)!;const date=entry.date;
          if(entry.kind!=='EVENT')return <Link key={entry.key} href={entry.href} data-entry-kind={entry.kind} data-event-type={entry.event_type} className={`min-w-0 overflow-hidden rounded-2xl border-2 shadow-md [overflow-wrap:anywhere] ${EVENT_COLORS[entry.event_type].card}`}><div className={`space-y-2 p-4 text-white sm:p-5 ${EVENT_COLORS[entry.event_type].header}`}><span className="inline-block rounded-full bg-white px-3 py-1 text-sm font-bold text-slate-900">{ENTRY_KIND_LABELS[entry.kind]}</span><h2 className="text-lg font-bold">{entry.name}</h2><p className="text-sm">{entry.parent_name}</p></div><div className="space-y-3 p-4 text-sm text-slate-900 sm:p-5"><EntryDate entry={entry}/><p className="break-words">📍 {entry.venue}</p></div></Link>;
          return (
            <Link
              key={entry.key} data-entry-kind={entry.kind}
              href={`/seminars/${seminar.id}`}
              data-event-type={seminar.event_type} className={`group block min-w-0 max-w-full overflow-hidden rounded-2xl border-2 shadow-md [overflow-wrap:anywhere] transition-shadow hover:shadow-xl focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-orange-700 ${EVENT_COLORS[seminar.event_type].card}`}
            >
              <div className={`p-4 sm:p-5 ${EVENT_COLORS[seminar.event_type].header}`}>
              <span className={`inline-block mb-3 border text-xs px-2 py-1 rounded-full font-bold ${EVENT_COLORS[seminar.event_type].badge}`}>{EVENT_TYPE_LABELS[seminar.event_type]}</span>
              <span className="inline-block mb-3 ml-2 text-xs bg-white/15 text-white px-2 py-1 rounded-full">開催方法：{eventDeliveryLabel(seminar)}</span>
                {seminar.dates.length > 0 && (
                  <span className="inline-block mb-3 ml-2 text-xs bg-white text-sky-900 px-2 py-1 rounded-full whitespace-nowrap flex-shrink-0">
                    {seminar.dates.length}日程
                  </span>
                )}
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-bold text-white text-lg leading-relaxed min-w-0 flex-1">
                  {date?eventSessionName(seminar,date):seminar.name}
                </h2>
              </div>

              </div><div className="p-4 sm:p-5">
              {seminar.dates.length > 0 && (
                <div className="text-sm text-slate-800 mb-3 space-y-0.5">
                  {(date?[date]:seminar.dates.slice(0, 2)).map((d, i) => (
                    <div key={i} className="flex min-w-0 items-start gap-1">
                      <span className="text-slate-400">📅</span>
                      <span>{formatEventDate(d, seminar.event_times)}</span>
                    </div>
                  ))}
                  {!date&&seminar.dates.length > 2 && (
                    <div className="text-slate-400 text-xs">他 {seminar.dates.length - 2} 日程...</div>
                  )}
                </div>
              )}

              {seminar.lecturer_name && (
                <div className="min-w-0 text-sm text-slate-800 mb-3 flex items-start gap-1">
                  <span className="text-slate-400">👨‍⚕️</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{seminar.lecturer_name}</span>
                </div>
              )}

              {eventMethodForDate(seminar,date??'')!=='ONLINE' && seminar.venue && (
                <div className="min-w-0 text-sm text-slate-800 mb-3 flex items-start gap-1">
                  <span className="text-slate-400">📍</span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{seminar.venue}</span>
                </div>
              )}

              <div className="mt-4 rounded-lg border border-sky-300 bg-white p-3">
                <ChecklistProgress seminar={seminar} />
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {CHECKLIST_ITEMS.map((item) => (
                  <span
                    key={item.key}
                    className={`text-xs border px-2 py-1 rounded-full ${
                      seminar[item.key]
                        ? 'border-green-300 bg-green-100 text-green-900'
                        : 'border-slate-300 bg-white text-slate-700'
                    }`}
                  >
                    {seminar[item.key] ? '✓' : '○'} {item.label}
                  </span>
                ))}
              </div>
              </div>
            </Link>
          );})}
        </div>
      )}
    </div>
  );
}
