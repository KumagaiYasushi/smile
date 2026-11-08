import {EVENT_COLORS} from '@/types/event-colors';
import {EVENT_TYPE_LABELS} from '@/types/seminar';
import type {EventType} from '@/types/seminar';
export default function EventTypeLegend(){return <div aria-label="イベント種別の色" className="flex flex-wrap gap-2">{(Object.keys(EVENT_TYPE_LABELS) as EventType[]).map(type=><span key={type} className={`rounded-full border px-3 py-1 text-xs font-bold ${EVENT_COLORS[type].badge}`}>{EVENT_TYPE_LABELS[type]}</span>)}</div>;}
