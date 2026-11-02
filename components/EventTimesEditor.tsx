'use client';

import type { EventTimes } from '@/types/event-schedule';

const fieldClass = 'mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
export default function EventTimesEditor({ dates, value, onChange }: { dates: string[]; value: EventTimes; onChange: (value: EventTimes) => void }) {
  return <fieldset className="space-y-4"><legend className="mb-2 text-sm font-medium">開催時刻（任意・日本時間）</legend>
    <p className="text-xs text-slate-500">初期状態は年月日だけです。必要な日だけ時刻を設定してください。</p>
    {dates.map(date => <div key={date} className="rounded-lg bg-slate-50 p-3">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!value[date]} onChange={e => {
        const next = { ...value }; if (e.target.checked) next[date] = { start: '', end: null }; else delete next[date]; onChange(next);
      }} />{date}の時刻を設定</label>
      {value[date] && <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block min-w-0 text-sm">開始時刻<input aria-label={`${date}の開始時刻`} type="time" required value={value[date].start} onChange={e => onChange({ ...value, [date]: { ...value[date], start: e.target.value } })} className={fieldClass} /></label>
        <label className="block min-w-0 text-sm">終了時刻<input aria-label={`${date}の終了時刻`} type="time" min={value[date].start || undefined} value={value[date].end ?? ''} onChange={e => onChange({ ...value, [date]: { ...value[date], end: e.target.value || null } })} className={fieldClass} /></label>
      </div>}
    </div>)}
  </fieldset>;
}
