import { getDb } from '@/lib/db';
import { createTemplateStore } from '@/lib/task-templates';
import { requireDate } from '@/types/task-template';
import { TaskError } from '@/types/task';

export const templateStore = () => createTemplateStore(getDb());

export function generationInput(body: unknown, apply = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TaskError('入力形式が不正です');
  const data = body as Record<string, unknown>;
  const allowed = apply ? ['base_date', 'preview_token'] : ['base_date'];
  if (Object.keys(data).some((key) => !allowed.includes(key))) throw new TaskError('入力項目が不正です');
  const baseDate = data.base_date === undefined ? undefined : requireDate(data.base_date);
  if (apply && (typeof data.preview_token !== 'string' || !/^[a-f0-9]{64}$/.test(data.preview_token))) throw new TaskError('プレビューを先に確認してください');
  return { baseDate, token: data.preview_token as string };
}
