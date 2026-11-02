import { deliveryMethodLabel } from '../types/seminar.ts';
import type { Seminar } from '../types/seminar.ts';

// Shared by generated emails and SNS announcements. Internal venue records are
// retained for online events, but are not advertised as a participant venue.
export function eventAttendanceText(event: Pick<Seminar, 'delivery_method' | 'venue'>): string {
  const method = `■ 開催方法\n${deliveryMethodLabel(event.delivery_method)}`;
  return event.delivery_method === 'ONLINE'
    ? method
    : `${method}\n\n■ 会場\n${event.venue || '（未定）'}`;
}
