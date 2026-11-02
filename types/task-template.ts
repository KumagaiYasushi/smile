import { isEventType } from './seminar.ts';
import type { EventType } from './seminar.ts';
import { parseTaskInput, TaskError } from './task.ts';

export type TemplateInput = { event_type: EventType; title: string; description: string; relative_days: number; important: boolean; active: boolean };
export type TaskTemplate = TemplateInput & { id: number; version: number };
export type GenerationItem = Pick<TaskTemplate, 'id' | 'version' | 'title' | 'description' | 'relative_days' | 'important'> & { due_date: string };
export type GenerationPreview = { base_date: string | null; event_type: EventType; items: GenerationItem[]; skipped_count: number; preview_token: string };

export function parseTemplateInput(value: unknown, partial = false): Partial<TemplateInput> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('テンプレートの入力形式が不正です');
  const body = value as Record<string, unknown>;
  const allowed = ['title', 'description', 'relative_days', 'important', 'active', ...(!partial ? ['event_type'] : [])];
  if (Object.keys(body).some((field) => !allowed.includes(field))) throw new TaskError('変更できない項目が含まれています');
  const common = Object.fromEntries(Object.entries(body).filter(([key]) => ['title', 'description', 'important'].includes(key)));
  const result: Partial<TemplateInput> = {};
  if (!partial || Object.keys(common).length) Object.assign(result, parseTaskInput(common, partial));
  if (!partial) {
    if (!isEventType(body.event_type)||body.event_type==='OTHER') throw new TaskError('イベント種別が不正です');
    result.event_type = body.event_type;
  }
  if ('relative_days' in body) {
    if (typeof body.relative_days !== 'number' || !Number.isInteger(body.relative_days) || Math.abs(body.relative_days) > 3650) throw new TaskError('期限の日数は-3650〜3650の整数で入力してください');
    result.relative_days = body.relative_days;
  } else if (!partial) throw new TaskError('期限の日数は必須です');
  if ('active' in body) {
    if (typeof body.active !== 'boolean') throw new TaskError('有効設定が不正です');
    result.active = body.active;
  }
  if (partial && Object.keys(result).length === 0) throw new TaskError('変更する項目がありません');
  return result;
}

export function requireDate(value: unknown): string {
  if (typeof value !== 'string') throw new TaskError('基準日を選択してください');
  parseTaskInput({ due_date: value }, true);
  return value;
}

export function relativeDueDate(baseDate: string, days: number) {
  requireDate(baseDate);
  if (!Number.isInteger(days) || Math.abs(days) > 3650) throw new TaskError('期限の日数が不正です');
  const date = new Date(`${baseDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return requireDate(date.toISOString().slice(0, 10));
}
