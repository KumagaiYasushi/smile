'use client';
import {EVENT_COLORS} from '@/types/event-colors';
import EventTypeLegend from '@/components/EventTypeLegend';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { eventDeliveryLabel,eventMethodForDate } from '@/types/event-options';
import {eventSessionName} from '@/types/event-session';
import { formatEventDate } from '@/types/event-schedule';
import { Seminar, CHECKLIST_ITEMS, EventType, EVENT_TYPE_LABELS } from '@/types/seminar';

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
  const [loading, setLoading] = useState(true);
  const [eventType, setEventType] = useState<EventType | 'ALL'>('ALL');

  useEffect(() => {
    fetch('/api/seminars')
      .then((r) => r.json())
      .then((data) => {
        setSeminars(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">読み込み中...</div>
    );
  }

  const filteredSeminars = seminars.filter((seminar) => eventType === 'ALL' || seminar.event_type === eventType);

  const cards=filteredSeminars.flatMap<{seminar:Seminar;date:string|null}>(seminar=>seminar.occurrence_type==='MULTIPLE'&&seminar.dates.length?[...seminar.dates].sort().map(date=>({seminar,date})):[{seminar,date:null}]);

  return (
    <div>
      <div className="mb-6 flex flex-col gap-4 border-b-2 border-slate-300 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div><h1 className="text-2xl font-bold text-slate-900">イベント一覧</h1><p className="mt-1 text-sm font-medium text-slate-700">{seminars.length===0?'イベントはまだ登録されていません':`全 ${seminars.length} 件`}</p></div>
        <Link href="/seminars/new" className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border-2 border-orange-800 bg-orange-700 px-5 py-3 text-base font-bold text-white shadow-md transition-colors hover:bg-orange-800 focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-orange-700 sm:w-auto"><span aria-hidden="true" className="text-2xl leading-none">＋</span>新規イベントを作成</Link>
      </div>

      <div className="mb-4"><EventTypeLegend/></div>
      <div className="mb-6 rounded-xl border border-slate-300 bg-slate-100 p-4">
        <label htmlFor="event-type-filter" className="block text-sm font-medium text-slate-700 mb-2">イベント種別で絞り込み</label>
        <select id="event-type-filter" value={eventType} onChange={(e) => setEventType(e.target.value as EventType | 'ALL')} className="w-full sm:w-64 border border-slate-300 rounded-lg bg-white px-3 py-2 text-sm">
          <option value="ALL">すべて</option>
          {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <p className="text-sm text-slate-500 mt-2" aria-live="polite">{filteredSeminars.length} 件を表示</p>
      </div>

      {seminars.length === 0 ? (
        <div className="bg-sky-50 rounded-2xl border-2 border-sky-300 p-6 sm:p-12 text-center">
          <div className="text-5xl mb-4">📋</div>
          <h2 className="text-xl font-bold text-slate-700 mb-2">セミナーを登録しましょう</h2>
          <p className="text-slate-500 text-sm mb-6">上の「新規イベントを作成」ボタンから登録できます</p>
        </div>
      ) : filteredSeminars.length === 0 ? (
        <p className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500">この種別のイベントはまだ登録されていません</p>
      ) : (
        <div aria-label="登録済みイベント" className="grid min-w-0 grid-cols-1 gap-5 rounded-2xl border border-slate-300 bg-slate-100 p-3 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          {cards.map(({seminar,date}) => (
            <Link
              key={`${seminar.id}-${date??'event'}`}
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

              {(seminar.dates.length?seminar.dates.some(date=>eventMethodForDate(seminar,date)!=='ONLINE'):seminar.delivery_method!=='ONLINE') && seminar.venue && (
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
          ))}
        </div>
      )}
    </div>
  );
}
