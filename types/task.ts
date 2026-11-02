export const TASK_STATUS_LABELS = {
  NOT_STARTED: '未着手',
  IN_PROGRESS: '進行中',
  IN_REVIEW: '確認待ち',
  DONE: '完了',
} as const;

export type TaskStatus = keyof typeof TASK_STATUS_LABELS;
export type TaskInput = {
  title: string;
  description: string;
  due_date: string | null;
  status: TaskStatus;
  important: boolean;
  assignee_id: number | null;
  collaborator_ids: number[];
};
export type EventTask = TaskInput & {
  id: number;
  seminar_id: number;
  version: number;
  created_at: string;
  updated_at: string;
};
export type TaskMember = { id: number; email: string };
export type TaskAuditSnapshot = Pick<TaskInput, 'due_date' | 'status' | 'important' | 'assignee_id' | 'collaborator_ids'>;
export type TaskHistory = {
  id: number;
  actor_id: number;
  action: 'created' | 'updated' | 'deleted';
  before: TaskAuditSnapshot | null;
  after: TaskAuditSnapshot | null;
  changed_fields: string[];
  occurred_at: string;
};

export class TaskError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function parseId(value: string) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new TaskError('IDが不正です');
  return Number(value);
}

export function parseVersion(value: unknown) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new TaskError('最新のバージョンが必要です');
  return value;
}

export function parseTaskInput(value: unknown, partial = false): Partial<TaskInput> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('タスクの入力形式が不正です');
  const body = value as Record<string, unknown>;
  const fields = ['title', 'description', 'due_date', 'status', 'important', 'assignee_id', 'collaborator_ids'];
  if (Object.keys(body).some((key) => !fields.includes(key))) throw new TaskError('変更できない項目が含まれています');
  const result: Partial<TaskInput> = {};
  if ('title' in body) {
    if (typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 200) throw new TaskError('タスク名は1〜200文字で入力してください');
    result.title = body.title.trim();
  } else if (!partial) throw new TaskError('タスク名は必須です');
  if ('description' in body) {
    if (typeof body.description !== 'string' || body.description.length > 2000) throw new TaskError('説明は2000文字以内で入力してください');
    result.description = body.description;
  }
  if ('due_date' in body) {
    const date = body.due_date;
    if (date !== null && (typeof date !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)
      || date.startsWith('0000') || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
      || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date)) throw new TaskError('期限の日付が不正です');
    result.due_date = date as string | null;
  }
  if ('status' in body) {
    if (typeof body.status !== 'string' || !Object.hasOwn(TASK_STATUS_LABELS, body.status)) throw new TaskError('タスクの状態が不正です');
    result.status = body.status as TaskStatus;
  }
  if ('important' in body) {
    if (typeof body.important !== 'boolean') throw new TaskError('重要設定が不正です');
    result.important = body.important;
  }
  if ('assignee_id' in body) {
    if (body.assignee_id !== null && (typeof body.assignee_id !== 'number' || !Number.isSafeInteger(body.assignee_id) || body.assignee_id < 1)) throw new TaskError('主担当者が不正です');
    result.assignee_id = body.assignee_id as number | null;
  }
  if ('collaborator_ids' in body) {
    if (!Array.isArray(body.collaborator_ids) || body.collaborator_ids.length > 100
      || body.collaborator_ids.some((id) => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1)
      || new Set(body.collaborator_ids).size !== body.collaborator_ids.length) throw new TaskError('協力者の指定が不正です');
    result.collaborator_ids = body.collaborator_ids as number[];
  }
  if (partial && Object.keys(result).length === 0) throw new TaskError('変更する項目がありません');
  return result;
}

export function todayInTokyo(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(now);
}

export function isTaskOverdue(task: Pick<TaskInput, 'status' | 'due_date'>, today = todayInTokyo()) {
  return task.status !== 'DONE' && task.due_date !== null && task.due_date < today;
}
