'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import StudyCalendar from '@/components/StudyCalendar';
import {apiJson} from '@/lib/client-api';
import {EVENT_TYPE_LABELS} from '@/types/seminar';
import type {HomeKind,HomeRow} from '@/types/home';
const FILTERS={ALL:'すべて',BASIC_COURSE:'ベーシックコース',LECTURE:'講演会',SEMINAR:'セミナー',MEETING:'打ち合わせ',OTHER:'その他'} as const;
export default function HomePage(){
  const [rows,setRows]=useState<HomeRow[]>([]),[filter,setFilter]=useState<HomeKind|'ALL'>('ALL'),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();apiJson('/api/home',{signal:controller.signal}).then(data=>setRows(data.rows)).catch(e=>{if(!controller.signal.aborted)setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[]);
  const visible=rows.filter(row=>filter==='ALL'||row.kind===filter);
  return <div className="space-y-5"><h1 className="text-2xl font-bold">HOME</h1><p className="text-sm text-slate-600">イベントと打ち合わせの日程を日付順に表示します。</p><StudyCalendar/><div role="group" aria-label="HOMEの種別で絞り込み" className="flex flex-wrap gap-2">{Object.entries(FILTERS).map(([value,label])=><button key={value} aria-pressed={filter===value} onClick={()=>setFilter(value as HomeKind|'ALL')} className={`rounded-lg border px-3 py-2 text-sm ${filter===value?'border-sky-800 bg-sky-800 text-white':'border-slate-300 bg-white'}`}>{label}</button>)}</div>
    {error&&<p role="alert" className="text-red-700">{error}</p>}{loading?<p>読み込み中…</p>:<><p role="status" className="text-sm text-slate-600">{visible.length}件を表示</p><div className="overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)] gap-3 bg-slate-50 p-4 text-sm font-bold sm:grid" aria-hidden="true"><span>イベント名・予定</span><span>日程</span><span>種別</span></div><ul aria-label="HOMEの日程一覧" className="divide-y divide-slate-200">{visible.map(row=><li key={row.key} className="grid min-w-0 gap-2 p-4 text-sm sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)] sm:gap-3"><div className="min-w-0"><Link href={row.meeting_id?`/seminars/${row.event_id}/meetings`:`/seminars/${row.event_id}`} className="break-words font-bold text-sky-800 underline">{row.event_name}</Link><p className="mt-1 break-words text-slate-600">{row.title}</p></div><p>{row.date??'日程未定'}{row.time?` ${row.time}（日本時間）`:''}</p><p>{FILTERS[row.kind]}{row.kind==='MEETING'&&<span className="block text-xs text-slate-500">{EVENT_TYPE_LABELS[row.parent_type]}</span>}</p></li>)}</ul>{!visible.length&&<p className="p-6 text-slate-500">この種別の予定はありません</p>}</div></>}
  </div>;
}
