'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { apiJson } from '@/lib/client-api';
import { todayInTokyo } from '@/types/task';
import { eventMethodForDate } from '@/types/event-options';
import { inWeatherWindow } from '@/types/weather';
import type { Seminar } from '@/types/seminar';
import type { EventWeatherData } from '@/types/weather';

type WeatherEvent = Pick<Seminar, 'id' | 'dates' | 'delivery_method' | 'session_delivery_methods'>;
type WeatherContext = { data: EventWeatherData | null; error: boolean; today: string };
const Context = createContext<WeatherContext | null>(null);
export function EventWeatherProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<EventWeatherData | null>(null), [error, setError] = useState(false);
  const [today, setToday] = useState(() => todayInTokyo());
  const currentDate = useRef(today), nextCheck = useRef(0);
  useEffect(() => {
    const controller = new AbortController(); let pending = false;
    async function check() {
      if (pending || document.visibilityState === 'hidden') return;
      const day = todayInTokyo(), changed = currentDate.current !== day;
      if (changed) { currentDate.current = day; setToday(day); }
      if (!changed && Date.now() < nextCheck.current) return;
      pending = true;
      try {
        const result: EventWeatherData = await apiJson('/api/weather', { signal: controller.signal });
        if (!Array.isArray(result.forecasts) || typeof result.as_of_date !== 'string') throw new Error();
        if (!controller.signal.aborted) { setData(result); setError(false); nextCheck.current = Date.now() + (result.forecasts.some(f => f.state === 'UNAVAILABLE') ? 5 * 60000 : 3600000); }
      } catch { if (!controller.signal.aborted) { setData(null); setError(true); nextCheck.current = Date.now() + 5 * 60000; } }
      finally { pending = false; }
    }
    void check();
    const timer = setInterval(() => void check(), 60000), visible = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return <Context.Provider value={{ data, error, today }}>{children}</Context.Provider>;
}

export default function EventWeather({ event, date, compact = false }: { event: WeatherEvent; date: string | null; compact?: boolean }) {
  const context = useContext(Context);
  if (!context || !date || !inWeatherWindow(date, context.today) || eventMethodForDate(event, date) === 'ONLINE') return null;
  const forecast = context.data?.as_of_date === context.today ? context.data.forecasts.find(f => f.seminar_id === event.id && f.date === date) : undefined;
  const note = context.error || forecast?.state === 'UNAVAILABLE' ? '天気予報を取得できません。時間をおいて再度ご確認ください。'
    : forecast?.state === 'MISSING_LOCATION' ? '天気予報：会場の住所に都道府県・市区町村を設定してください。'
    : !forecast ? '天気予報を確認中…' : null;
  const base = compact ? 'my-2 rounded-lg border p-2 text-xs' : 'rounded-xl border p-4 text-sm';
  if (note) return <div data-event-weather={`${event.id}:${date}`} className={`${base} border-slate-300 bg-slate-50 text-slate-700`}>{note}</div>;
  const item = forecast!;
  const updated = item.issued_at ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(item.issued_at)) : null;
  return <div data-event-weather={`${event.id}:${date}`} data-weather-state={item.state} className={`${base} space-y-1.5 ${item.severe ? 'border-red-300 bg-red-50' : 'border-sky-300 bg-sky-50'} text-slate-900`}>
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold"><span aria-hidden="true">{item.icon}</span><span>{compact ? '当日の天気' : `${date}の天気`}</span><span className={item.severe ? 'text-red-800' : ''}>{item.label ?? '予報未発表'}</span></div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 tabular-nums"><span>最高 <strong className="text-red-800">{item.max === null ? '未発表' : `${item.max}℃`}</strong></span><span>最低 <strong className="text-blue-900">{item.min === null ? '未発表' : `${item.min}℃`}</strong></span></div>
    {(item.region || item.station) && <p className="break-words text-xs text-slate-700">{item.region && `予報地域：${item.region}`}{item.station && ` ／ 気温：${item.station}`}</p>}
    {updated && <p className="text-xs text-slate-600">気象庁 {updated} 発表</p>}
  </div>;
}

export function WeatherAttribution() {
  const context = useContext(Context);
  if (!context?.data?.forecasts.length) return null;
  return <p className="mt-3 text-xs leading-relaxed text-slate-700">出典：<a href="https://www.jma.go.jp/bosai/forecast/" target="_blank" rel="noopener noreferrer" className="text-sky-900 underline">気象庁の天気予報</a>。気温は地域の代表地点の予報です。予報は約1時間ごとに確認します。</p>;
}

export function EventWeatherPanel({ event }: { event: WeatherEvent }) {
  const context = useContext(Context);
  const dates = [...new Set(event.dates)].filter(date => inWeatherWindow(date, context?.today) && eventMethodForDate(event, date) !== 'ONLINE').sort();
  if (!dates.length) return null;
  return <section aria-label="開催日の天気予報" className="space-y-3 rounded-2xl border border-sky-300 bg-white p-4 sm:p-5"><h2 className="text-lg font-bold text-slate-900">開催日の天気予報</h2><p className="text-sm text-slate-700">開催日の1週間前から当日まで表示します。</p><div className="grid gap-3 sm:grid-cols-2">{dates.map(date => <EventWeather key={date} event={event} date={date}/>)}</div><WeatherAttribution/></section>;
}
