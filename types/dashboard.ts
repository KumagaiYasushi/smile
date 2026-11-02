import { TaskError } from './task.ts';
import type { TaskStatus } from './task.ts';
import type { EventType } from './seminar.ts';

export const DASHBOARD_FILTER_LABELS = {
  ALL: 'すべての未完了タスク',
  OVERDUE: '期限超過',
  IN_REVIEW: '確認待ち',
  UNASSIGNED: '主担当未割当',
  IMPORTANT: '直近の重要タスク',
  MINE: '自分が関わるタスク',
} as const;
export type DashboardFilter = keyof typeof DASHBOARD_FILTER_LABELS;
export type DashboardQuery = { filter: DashboardFilter; days: number; page: number };
export type DashboardTask = {
  id: number; seminar_id: number; seminar_name: string; event_type: EventType;
  title: string; due_date: string | null; status: TaskStatus; important: boolean;
  assignee: { id: number; email: string; active: boolean } | null;
  is_primary: boolean; is_collaborator: boolean; overdue: boolean; upcoming_important: boolean;
};
export type DashboardData = {
  as_of_date: string; through_date: string; horizon_days: number; event_count: number;
  counts: Record<DashboardFilter, number>; filter: DashboardFilter;
  total: number; page: number; page_size: number; items: DashboardTask[];
};

export function parseDashboardQuery(params: URLSearchParams): DashboardQuery {
  const keys = [...params.keys()];
  if (new Set(keys).size !== keys.length || keys.some((key) => !['filter', 'days', 'page'].includes(key))) throw new TaskError('表示条件が不正です');
  const filter = params.get('filter') ?? 'ALL';
  if (!Object.hasOwn(DASHBOARD_FILTER_LABELS, filter)) throw new TaskError('タスクの表示対象が不正です');
  const rawDays = params.get('days') ?? '7';
  if (!['3', '7', '30'].includes(rawDays)) throw new TaskError('重要タスクの表示期間は3・7・30日から選択してください');
  const rawPage = params.get('page') ?? '1';
  if (!/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(Number(rawPage)) || Number(rawPage) > 100000) throw new TaskError('ページ番号が不正です');
  return { filter: filter as DashboardFilter, days: Number(rawDays), page: Number(rawPage) };
}
