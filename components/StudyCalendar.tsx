'use client';
import {useState} from 'react';
import {studyCalendarUrl,STUDY_CALENDAR_ICS_URL} from '@/types/study-calendar';
import type {CalendarView} from '@/types/study-calendar';
export default function StudyCalendar(){
  const [view,setView]=useState<CalendarView>('MONTH'),[refresh,setRefresh]=useState(0);
  return <section aria-label="歯周基本治療研究会カレンダー" className="min-w-0 space-y-3 rounded-xl border border-slate-200 bg-white p-3 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">研究会カレンダー</h2><div role="group" aria-label="カレンダーの表示切替" className="flex flex-wrap gap-2">{([['MONTH','月表示'],['AGENDA','予定一覧']] as const).map(([value,label])=><button key={value} type="button" aria-pressed={view===value} onClick={()=>setView(value)} className={`rounded-lg border px-3 py-2 text-sm ${view===value?'border-sky-800 bg-sky-800 text-white':'border-slate-300'}`}>{label}</button>)}</div></div>
    <p className="text-xs text-slate-500">日本時間で表示しています。</p>
    <iframe key={`${view}-${refresh}`} title="歯周基本治療研究会のGoogleカレンダー" src={studyCalendarUrl(view)} loading="lazy" referrerPolicy="no-referrer" className="h-[500px] w-full min-w-0 rounded-lg border-0 sm:h-[600px]"/>
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm"><a href={studyCalendarUrl(view)} target="_blank" rel="noopener noreferrer" className="text-sky-800 underline">Googleカレンダーを開く</a><a href={STUDY_CALENDAR_ICS_URL} className="text-sky-800 underline">iCal形式を開く</a><button type="button" onClick={()=>setRefresh(value=>value+1)} className="text-sky-800 underline">カレンダーを再表示</button></div>
  </section>;
}
