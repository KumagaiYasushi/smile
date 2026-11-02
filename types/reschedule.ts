import { requireDate } from './task-template.ts';
import { TaskError } from './task.ts';
import type { TaskStatus } from './task.ts';

export type DeadlineDecision = { task_id: number; action: 'keep' | 'proposed' } | { task_id: number; action: 'custom'; due_date: string | null };
export type ScheduleInput = { dates: string[]; base_date: string | null; preview_token: string; decisions: DeadlineDecision[] };
export type ScheduleItem = {
  task_id: number; version: number; title: string; status: TaskStatus; important: boolean;
  current_due_date: string | null; proposed_due_date: string | null;
  source: 'template' | 'manual'; source_base_date: string | null; relative_days: number | null; manually_changed: boolean;
};
export type SchedulePreview = {
  old_dates: string[]; new_dates: string[]; base_date: string | null; items: ScheduleItem[]; preview_token: string;
};
export type ScheduleHistory = {
  id: number; actor_id: number; old_dates: string[]; new_dates: string[]; base_date: string | null;
  decisions: DeadlineDecision[]; updated_task_ids: number[]; occurred_at: string;
};

export function parseScheduleInput(value: unknown, apply = false): ScheduleInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('日程変更の入力形式が不正です');
  const body = value as Record<string, unknown>;
  const fields = ['dates', 'base_date', ...(apply ? ['preview_token', 'decisions'] : [])];
  if (Object.keys(body).some((key) => !fields.includes(key))) throw new TaskError('変更できない項目が含まれています');
  if (!Array.isArray(body.dates) || body.dates.length > 100) throw new TaskError('開催日を日付の一覧で入力してください（最大100件）');
  const dates = body.dates.map(requireDate);
  if (new Set(dates).size !== dates.length) throw new TaskError('開催日が重複しています');
  const baseDate = body.base_date === undefined ? (dates.length === 1 ? dates[0] : null) : body.base_date === null ? null : requireDate(body.base_date);
  if (baseDate && !dates.includes(baseDate)) throw new TaskError('基準日は変更後の開催日から選択してください');
  const decisions: DeadlineDecision[] = [];
  if (apply) {
    if (typeof body.preview_token !== 'string' || !/^[a-f0-9]{64}$/.test(body.preview_token)) throw new TaskError('変更内容を先にプレビューしてください');
    if (!Array.isArray(body.decisions)) throw new TaskError('全タスクの期限の扱いを選択してください');
    for (const value of body.decisions) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('期限の選択が不正です');
      const decision = value as Record<string, unknown>;
      if (typeof decision.task_id !== 'number' || !Number.isSafeInteger(decision.task_id) || decision.task_id < 1) throw new TaskError('タスクIDが不正です');
      if (typeof decision.action !== 'string' || !['keep', 'proposed', 'custom'].includes(decision.action)) throw new TaskError('期限の扱いを選択してください');
      const allowed = ['task_id', 'action', ...(decision.action === 'custom' ? ['due_date'] : [])];
      if (Object.keys(decision).some((key) => !allowed.includes(key))) throw new TaskError('期限の選択に不正な項目があります');
      if (decision.action === 'custom') {
        if (!('due_date' in decision)) throw new TaskError('個別指定する期限を入力してください');
        decisions.push({ task_id: decision.task_id, action: 'custom', due_date: decision.due_date === null ? null : requireDate(decision.due_date) });
      } else decisions.push({ task_id: decision.task_id, action: decision.action as 'keep' | 'proposed' });
    }
    if (new Set(decisions.map((item) => item.task_id)).size !== decisions.length) throw new TaskError('タスクの選択が重複しています');
  }
  return { dates, base_date: baseDate, preview_token: apply ? body.preview_token as string : '', decisions: decisions.sort((a, b) => a.task_id - b.task_id) };
}
