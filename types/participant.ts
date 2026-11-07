import { TaskError } from './task.ts';

export type ParticipantRole = 'dental_hygienist' | 'dentist' | 'other';
export type PaymentStatus = 'unpaid' | 'paid';
export const PAYMENT_METHOD_LABELS = { bank_transfer: '銀行振込', cash: '現金', other: 'その他' } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHOD_LABELS;

export type Participant = {
  id: number;
  seminar_id: number;
  name: string;
  receipt_name: string;
  role: ParticipantRole;
  email: string;
  phone: string;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod | null;
  paid_amount: number | null;
  payment_confirmed_at: string | null;
  payment_confirmed_by: number | null;
  issued_receipt_id: number | null;
  receipt_issued_at: string | null;
  attended: boolean;
  receipt_number: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type ParticipantFields = Pick<Participant, 'name' | 'receipt_name' | 'role' | 'email' | 'phone' | 'payment_status' | 'payment_method' | 'paid_amount' | 'attended' | 'receipt_number' | 'notes'>;
export function canIssueReceipt(participant: Pick<Participant, 'payment_method' | 'payment_status' | 'paid_amount' | 'payment_confirmed_at'>) {
  return participant.payment_method === 'bank_transfer' && participant.payment_status === 'paid'
    && typeof participant.payment_confirmed_at === 'string' && participant.payment_confirmed_at.length > 0
    && typeof participant.paid_amount === 'number' && Number.isSafeInteger(participant.paid_amount) && participant.paid_amount >= 0;
}
export function parseParticipant(value: unknown, current?: ParticipantFields): ParticipantFields {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('参加者の入力形式が不正です');
  const body = value as Record<string, unknown>;
  const result: ParticipantFields = { name: '', receipt_name: '', role: 'other', email: '', phone: '', payment_status: 'unpaid', payment_method: null, paid_amount: null, attended: false, receipt_number: '', notes: '', ...current };
  if (Object.keys(body).some(key => !['name', 'receipt_name', 'role', 'email', 'phone', 'payment_status', 'payment_method', 'paid_amount', 'attended', 'receipt_number', 'notes'].includes(key))) throw new TaskError('変更できない参加者の項目が含まれています');
  for (const key of ['name', 'receipt_name', 'email', 'phone', 'receipt_number', 'notes'] as const) {
    if (!(key in body)) continue;
    const max = key === 'notes' ? 2000 : key === 'name' || key === 'receipt_name' ? 200 : key === 'email' ? 254 : 100;
    if (typeof body[key] !== 'string' || body[key].length > max) throw new TaskError('参加者の文字項目の入力形式または文字数が不正です');
    result[key] = body[key].trim();
  }
  if (!result.name) throw new TaskError('参加者名は必須です');
  if ('role' in body) {
    if (!['dental_hygienist', 'dentist', 'other'].includes(body.role as string)) throw new TaskError('職種が不正です');
    result.role = body.role as ParticipantRole;
  }
  if ('payment_status' in body) {
    if (!['paid', 'unpaid'].includes(body.payment_status as string)) throw new TaskError('入金状況が不正です');
    result.payment_status = body.payment_status as PaymentStatus;
  }
  if ('payment_method' in body) {
    if (body.payment_method !== null && (typeof body.payment_method !== 'string' || !Object.hasOwn(PAYMENT_METHOD_LABELS, body.payment_method))) throw new TaskError('支払方法が不正です');
    result.payment_method = body.payment_method as PaymentMethod | null;
  }
  if ('paid_amount' in body) {
    if (body.paid_amount !== null && (typeof body.paid_amount !== 'number' || !Number.isSafeInteger(body.paid_amount) || body.paid_amount < 0)) throw new TaskError('入金額は0円以上の整数で入力してください');
    result.paid_amount = body.paid_amount as number | null;
  }
  if ('attended' in body) {
    if (typeof body.attended !== 'boolean') throw new TaskError('出席状況が不正です');
    result.attended = body.attended;
  }
  if (result.payment_status === 'unpaid') result.paid_amount = null;
  return Object.fromEntries(['name', 'receipt_name', 'role', 'email', 'phone', 'payment_status', 'payment_method', 'paid_amount', 'attended', 'receipt_number', 'notes'].map(key => [key, result[key as keyof ParticipantFields]])) as ParticipantFields;
}

export const ROLE_LABELS: Record<ParticipantRole, string> = {
  dental_hygienist: '歯科衛生士',
  dentist: '歯科医師',
  other: 'その他',
};

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: '未入金',
  paid: '入金済',
};
