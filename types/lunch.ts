import { TaskError } from './task.ts';
import { requireDate } from './task-template.ts';

export const LUNCH_TARGET_LABELS = { LECTURER: '講師', EXTERNAL_LECTURER: '外来講師', SUPPORT: 'サポートメンバー', PARTICIPANT: '参加者', OTHER: 'その他' } as const;
export const LUNCH_STATUS_LABELS = { UNDECIDED: '未定', PLANNED: '手配予定', ORDERED: '注文済み', CANCELLED: '中止' } as const;
export type LunchTarget = keyof typeof LUNCH_TARGET_LABELS;
export type LunchStatus = keyof typeof LUNCH_STATUS_LABELS;
export type LunchInput = {
  date: string | null; target: LunchTarget; target_details: string;
  quantity: number | null; unit_price: number | null; additional_cost: number | null;
  shop_name: string; shop_contact: string; menu: string; notes: string; status: LunchStatus;
};
export type LunchPlan = LunchInput & { id: number; seminar_id: number; version: number; updated_at: string };
export type LunchSnapshot = Pick<LunchInput, 'date' | 'target' | 'quantity' | 'unit_price' | 'additional_cost' | 'status'>;
export type LunchHistory = {
  id: number; plan_id: number; actor_id: number; action: 'created' | 'updated' | 'deleted';
  before: LunchSnapshot | null; after: LunchSnapshot | null; occurred_at: string;
};
export type LunchData = { event_name: string; dates: string[]; plans: LunchPlan[]; history: LunchHistory[] };

export function emptyLunch(): LunchInput {
  return { date: null, target: 'LECTURER', target_details: '', quantity: null, unit_price: null, additional_cost: 0,
    shop_name: '', shop_contact: '', menu: '', notes: '', status: 'UNDECIDED' };
}
export function lunchCost(plan: Pick<LunchInput, 'quantity' | 'unit_price' | 'additional_cost'>): number | null {
  if (plan.quantity === null || plan.unit_price === null || plan.additional_cost === null) return null;
  const total = plan.quantity * plan.unit_price + plan.additional_cost;
  if (!Number.isSafeInteger(total)) throw new TaskError('昼食の合計費用が大きすぎます');
  return total;
}
export function summarizeLunch(plans: LunchPlan[]) {
  const active = plans.filter(plan => plan.status !== 'CANCELLED');
  const known = active.map(lunchCost);
  // BigInt keeps totals exact even across many individually valid large orders.
  return { quantity: active.reduce((sum, plan) => sum + BigInt(plan.quantity ?? 0), BigInt(0)).toString(),
    quantity_unknown: active.filter(plan => plan.quantity === null).length,
    cost: known.reduce<bigint>((sum, cost) => sum + BigInt(cost ?? 0), BigInt(0)).toString(),
    cost_unknown: known.filter(cost => cost === null).length };
}
export function parseLunch(value: unknown): LunchInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('昼食の入力形式が不正です');
  const body = value as Record<string, unknown>, result = emptyLunch();
  if (Object.keys(body).some(key => !Object.hasOwn(result, key))) throw new TaskError('変更できない項目が含まれています');
  if (typeof body.target !== 'string' || !Object.hasOwn(LUNCH_TARGET_LABELS, body.target)) throw new TaskError('昼食を用意する対象を選択してください');
  result.target = body.target as LunchTarget;
  if (body.status !== undefined) {
    if (typeof body.status !== 'string' || !Object.hasOwn(LUNCH_STATUS_LABELS, body.status)) throw new TaskError('昼食の手配状態が不正です');
    result.status = body.status as LunchStatus;
  }
  if (body.date !== undefined && body.date !== null) result.date = requireDate(body.date);
  for (const key of ['target_details', 'shop_name', 'shop_contact', 'menu', 'notes'] as const) {
    if (body[key] === undefined) continue;
    const max = key === 'notes' ? 2000 : key === 'shop_name' || key === 'menu' ? 200 : 1000;
    if (typeof body[key] !== 'string' || body[key].length > max) throw new TaskError('昼食の文字項目が長すぎるか入力形式が不正です');
    result[key] = body[key].trim();
  }
  for (const key of ['quantity', 'unit_price', 'additional_cost'] as const) {
    if (body[key] === undefined) continue;
    const number = body[key];
    if (number !== null && (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0)) throw new TaskError('人数・費用は0以上の整数、または未定で入力してください');
    result[key] = number as number | null;
  }
  lunchCost(result);
  return result;
}
