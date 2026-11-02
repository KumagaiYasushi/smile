import { deliveryMethodLabel } from '../types/seminar.ts';
import { eventMethodForDate } from '../types/event-options.ts';
import { formatEventDate } from '../types/event-schedule.ts';
import type { Seminar } from '../types/seminar.ts';
export function eventAttendanceText(event: Pick<Seminar, 'delivery_method' | 'venue'> & Partial<Pick<Seminar,'dates'|'session_delivery_methods'|'event_times'|'external_lecturer'>>) {
  const perDate=event.dates?.length&&event.dates.some(date=>event.session_delivery_methods?.[date]);
  const method=perDate?`■ 開催方法\n${event.dates!.map(date=>`${formatEventDate(date,event.event_times)}：${deliveryMethodLabel(eventMethodForDate(event,date))}`).join('\n')}`:`■ 開催方法\n${deliveryMethodLabel(event.delivery_method)}`;
  const onsite=perDate?event.dates!.some(date=>eventMethodForDate(event,date)!=='ONLINE'):event.delivery_method!=='ONLINE';
  const external=event.external_lecturer?.status==='YES'?`\n\n■ 外来講師\n${event.external_lecturer.name}\n${event.external_lecturer.facility}`:'';
  return (onsite?`${method}\n\n■ 会場\n${event.venue||'（未定）'}`:method)+external;
}
export function eventFeeText(event:Pick<Seminar,'fee_dental_hygienist'|'fee_dentist'|'fee_other'> & Partial<Pick<Seminar,'occurrence_type'|'repeat_fees'>>) {
  const labels={dental_hygienist:'歯科衛生士',dentist:'歯科医師',other:'その他'} as const;
  const fees={dental_hygienist:event.fee_dental_hygienist,dentist:event.fee_dentist,other:event.fee_other};
  const total=Object.entries(labels).map(([role,label])=>`${label}：¥${fees[role as keyof typeof labels].toLocaleString()}`).join('\n');
  if(event.occurrence_type!=='MULTIPLE')return total;
  return `複数回合計金額\n${total}\n\n単回金額（再受講用・1回あたり）\n${Object.entries(labels).map(([role,label])=>{const fee=event.repeat_fees?.[role as keyof typeof labels];return `${label}：${fee==null?'未設定':`¥${fee.toLocaleString()}`}`;}).join('\n')}`;
}
