import { TaskError } from './task.ts';

export type VenueInput = {
  name: string; room: string; address: string; access: string; contact_person: string;
  phone: string; email: string; website: string; capacity: number | null;
  reference_fee: number | null; fee_unit: string; equipment: string; booking_notes: string; notes: string; active: boolean;
};
export type Venue = VenueInput & { id: number; version: number; created_at: string; updated_at: string };
export type VenueStatus = 'ACTIVE' | 'INACTIVE' | 'ALL';
export const VENUE_FIELDS = ['name', 'room', 'address', 'access', 'contact_person', 'phone', 'email', 'website', 'capacity', 'reference_fee', 'fee_unit', 'equipment', 'booking_notes', 'notes', 'active'] as const;
export const VENUE_FIELD_LABELS: Record<keyof VenueInput, string> = {
  name: '会場名', room: '部屋名', address: '住所', access: 'アクセス', contact_person: '窓口担当者', phone: '電話番号',
  email: 'メールアドレス', website: '公式サイト・予約ページ', capacity: '定員（人）', reference_fee: '参考料金（円）',
  fee_unit: '料金の単位・条件', equipment: '設備・備品', booking_notes: '予約方法・キャンセル条件', notes: '備考', active: '利用候補として表示',
};
export type VenueHistory = {
  id: number; venue_id: number; actor_id: number; action: 'created' | 'updated'; changed_fields: (keyof VenueInput)[];
  before: Pick<VenueInput, 'active' | 'capacity' | 'reference_fee'> | null;
  after: Pick<VenueInput, 'active' | 'capacity' | 'reference_fee'>; occurred_at: string;
};
export function emptyVenue(): VenueInput {
  return { name: '', room: '', address: '', access: '', contact_person: '', phone: '', email: '', website: '', capacity: null,
    reference_fee: null, fee_unit: '', equipment: '', booking_notes: '', notes: '', active: true };
}
export function venueLocation(venue: Pick<VenueInput, 'name' | 'room' | 'address'>): string {
  return [venue.name, venue.room, venue.address].filter(Boolean).join(' / ');
}
export function parseVenue(value: unknown, current?: VenueInput): VenueInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('会場の入力形式が不正です');
  const body = value as Record<string, unknown>, result = { ...(current ?? emptyVenue()) };
  if (Object.keys(body).some(key => !VENUE_FIELDS.includes(key as keyof VenueInput))) throw new TaskError('変更できない項目が含まれています');
  for (const key of ['name', 'room', 'address', 'access', 'contact_person', 'phone', 'email', 'website', 'fee_unit', 'equipment', 'booking_notes', 'notes'] as const) {
    if (!(key in body)) continue;
    const max = ['name', 'room', 'contact_person'].includes(key) ? 200 : ['phone', 'fee_unit'].includes(key) ? 100 : key === 'email' ? 254 : 2000;
    if (typeof body[key] !== 'string' || body[key].length > max) throw new TaskError(`${VENUE_FIELD_LABELS[key]}の文字数または入力形式が不正です`);
    result[key] = body[key].trim();
  }
  if (!result.name) throw new TaskError('会場名は必須です');
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new TaskError('メールアドレスが不正です');
  if (result.website) {
    try {
      const url = new URL(result.website);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
    } catch { throw new TaskError('公式サイトはhttpまたはhttpsのURLを入力してください'); }
  }
  for (const key of ['capacity', 'reference_fee'] as const) {
    if (!(key in body)) continue;
    const number = body[key];
    if (number !== null && (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0)) throw new TaskError(`${VENUE_FIELD_LABELS[key]}は0以上の整数、または未定で入力してください`);
    result[key] = number as number | null;
  }
  if ('active' in body) {
    if (typeof body.active !== 'boolean') throw new TaskError('利用状態が不正です');
    result.active = body.active;
  }
  // Only input fields are returned, even when a full persisted record is supplied as current.
  return Object.fromEntries(VENUE_FIELDS.map(key => [key, result[key]])) as VenueInput;
}
