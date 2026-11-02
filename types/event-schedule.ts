import { TaskError } from './task.ts';
import { requireDate } from './task-template.ts';

export const OCCURRENCE_LABELS = { SINGLE: '単回', MULTIPLE: '複数回' } as const;
export type OccurrenceType = keyof typeof OCCURRENCE_LABELS;
export type EventTimes = Record<string, { start: string; end: string | null }>;
export function requireOccurrence(value: unknown): OccurrenceType {
  if (typeof value !== 'string' || !Object.hasOwn(OCCURRENCE_LABELS, value)) throw new TaskError('開催回数を単回・複数回から選択してください');
  return value as OccurrenceType;
}
export function eventDates(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new TaskError('開催日は100件以内の日付で入力してください');
  const dates = value.map(requireDate);
  if (new Set(dates).size !== dates.length) throw new TaskError('開催日が重複しています');
  return dates;
}
export function validateOccurrences(type: unknown, dates: string[]) {
  const occurrence = requireOccurrence(type);
  if (occurrence === 'SINGLE' && dates.length > 1) throw new TaskError('単回の場合は開催日を1日にしてください。複数日を登録する場合は複数回を選択してください');
  return occurrence;
}
export function parseEventTimes(value: unknown, dates: string[]): EventTimes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('開催時刻の入力形式が不正です');
  const result: EventTimes = {};
  const validTime = (value: unknown): value is string => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  for (const [date, input] of Object.entries(value)) {
    if (!dates.includes(date) || !input || typeof input !== 'object' || Array.isArray(input)) throw new TaskError('開催時刻は登録済みの開催日ごとに指定してください');
    const time = input as Record<string, unknown>;
    if (Object.keys(time).some(key => !['start', 'end'].includes(key)) || !validTime(time.start)
      || (time.end !== null && time.end !== undefined && !validTime(time.end))) throw new TaskError('開始・終了時刻は時分で入力してください');
    const end = time.end == null ? null : time.end as string;
    if (end && end < time.start) throw new TaskError('終了時刻は開始時刻以降にしてください');
    result[date] = { start: time.start, end };
  }
  return result;
}
export function formatEventDate(date: string, times: EventTimes = {}): string {
  const [year, month, day] = date.split('-').map(Number);
  const time = times[date];
  return `${year}年${month}月${day}日${time ? ` ${time.start}${time.end ? `〜${time.end}` : ''}（日本時間）` : ''}`;
}
