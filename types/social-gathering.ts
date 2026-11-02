import { TaskError } from './task.ts';

export const SOCIAL_STATUS_LABELS = { UNDECIDED: '未定', HELD: '開催する', NOT_HELD: '開催しない' } as const;
export type SocialStatus = keyof typeof SOCIAL_STATUS_LABELS;
export type SocialGathering = {
  status: SocialStatus;
  start_at: string | null;
  end_at: string | null;
  venue: string;
  fee: number | null;
};

export function emptySocialGathering(): SocialGathering {
  return { status: 'UNDECIDED', start_at: null, end_at: null, venue: '', fee: null };
}

function dateTime(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}$/.test(value)
    || value.startsWith('0000') || !Number.isFinite(Date.parse(`${value}:00Z`))
    || new Date(`${value}:00Z`).toISOString().slice(0, 16) !== value) throw new TaskError('懇親会の日時が不正です');
  return value;
}

export function parseSocialGathering(value: unknown): SocialGathering {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('懇親会の入力形式が不正です');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['status', 'start_at', 'end_at', 'venue', 'fee'].includes(key))) throw new TaskError('懇親会に変更できない項目が含まれています');
  if (typeof body.status !== 'string' || !Object.hasOwn(SOCIAL_STATUS_LABELS, body.status)) throw new TaskError('懇親会の開催有無を選択してください');
  const start = dateTime(body.start_at), end = dateTime(body.end_at);
  if (end && !start) throw new TaskError('懇親会の終了日時を登録する場合は開始日時も入力してください');
  if (start && end && end < start) throw new TaskError('懇親会の終了日時は開始日時以降にしてください');
  if (body.venue !== undefined && (typeof body.venue !== 'string' || body.venue.length > 2000)) throw new TaskError('懇親会の場所は2000文字以内で入力してください');
  const fee = body.fee === undefined ? null : body.fee;
  if (fee !== null && (typeof fee !== 'number' || !Number.isSafeInteger(fee) || fee < 0)) throw new TaskError('懇親会の参加費は0円以上の整数で入力してください');
  return { status: body.status as SocialStatus, start_at: start, end_at: end, venue: (body.venue as string | undefined)?.trim() ?? '', fee };
}

export function mergeSocialGathering(current: SocialGathering, patch: unknown): SocialGathering {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TaskError('懇親会の入力形式が不正です');
  return parseSocialGathering({ ...current, ...patch });
}

// Stored as a Japanese local wall-clock time, independent of the browser's zone.
export function formatSocialDateTime(value: string | null): string {
  if (!value) return '未定';
  const [date, time] = value.split('T');
  return `${date.replace('-', '年').replace('-', '月')}日 ${time}（日本時間）`;
}
