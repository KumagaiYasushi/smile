import { TaskError } from './task.ts';
export const SOCIETY_ROLE_LABELS = { SOCIETY_LECTURER: '研究会講師', SOCIETY_SUPPORT: '研究会サポートメンバー' } as const;
export type SocietyRole = keyof typeof SOCIETY_ROLE_LABELS;
export type SocietyMember = { id: number; name: string; role: SocietyRole; active: boolean; version: number };
export function parseSocietyMember(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('名簿の入力形式が不正です');
  const body = value as Record<string, unknown>;
  if (Object.keys(body).some(key => !['name','role','active','version'].includes(key))) throw new TaskError('変更できない項目が含まれています');
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 200) throw new TaskError('氏名は1〜200文字で入力してください');
  if (typeof body.role !== 'string' || !Object.hasOwn(SOCIETY_ROLE_LABELS,body.role)) throw new TaskError('研究会講師・研究会サポートメンバーから選択してください');
  if (typeof body.active !== 'boolean') throw new TaskError('利用状態が不正です');
  return { name: body.name.trim(), role: body.role as SocietyRole, active: body.active };
}
