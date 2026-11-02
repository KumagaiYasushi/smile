import type Database from 'better-sqlite3';
import { createTaskStore } from './tasks.ts';
import { todayInTokyo, TaskError } from '../types/task.ts';
import { relativeDueDate } from '../types/task-template.ts';
import { parseDashboardQuery } from '../types/dashboard.ts';
import type { DashboardData, DashboardQuery, DashboardTask, DashboardFilter } from '../types/dashboard.ts';

export function createDashboardStore(db: Database.Database) {
  createTaskStore(db);
  const mine = `(t.assignee_id=@actor OR EXISTS(SELECT 1 FROM task_collaborators c WHERE c.task_id=t.id AND c.user_id=@actor))`;
  const conditions: Record<DashboardFilter, string> = {
    ALL: '1=1', OVERDUE: '(t.due_date IS NOT NULL AND t.due_date<@today)', IN_REVIEW: "t.status='IN_REVIEW'",
    UNASSIGNED: 't.assignee_id IS NULL', IMPORTANT: '(t.important=1 AND t.due_date BETWEEN @today AND @through)', MINE: mine,
  };
  const base = `FROM event_tasks t JOIN seminars s ON s.id=t.seminar_id LEFT JOIN auth_users u ON u.id=t.assignee_id WHERE t.status<>'DONE'`;
  return {
    getDashboard(actorId: number, query: DashboardQuery = { filter: 'ALL', days: 7, page: 1 }, now = new Date()): DashboardData {
      const options = parseDashboardQuery(new URLSearchParams({ filter: query.filter, days: String(query.days), page: String(query.page) }));
      const today = todayInTokyo(now);
      const through = relativeDueDate(today, options.days);
      const params = { actor: actorId, today, through };
      return db.transaction(() => {
        if (!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId)) throw new TaskError('ログインが必要です', 403);
        const counts = db.prepare(`SELECT count(*) AS ALL_COUNT,
          COALESCE(sum(CASE WHEN ${conditions.OVERDUE} THEN 1 ELSE 0 END),0) AS OVERDUE,
          COALESCE(sum(CASE WHEN ${conditions.IN_REVIEW} THEN 1 ELSE 0 END),0) AS IN_REVIEW,
          COALESCE(sum(CASE WHEN ${conditions.UNASSIGNED} THEN 1 ELSE 0 END),0) AS UNASSIGNED,
          COALESCE(sum(CASE WHEN ${conditions.IMPORTANT} THEN 1 ELSE 0 END),0) AS IMPORTANT,
          COALESCE(sum(CASE WHEN ${mine} THEN 1 ELSE 0 END),0) AS MINE ${base}`).get(params) as Record<string, number>;
        const summary = { ALL: counts.ALL_COUNT, OVERDUE: counts.OVERDUE, IN_REVIEW: counts.IN_REVIEW,
          UNASSIGNED: counts.UNASSIGNED, IMPORTANT: counts.IMPORTANT, MINE: counts.MINE };
        const total = summary[options.filter];
        const pageSize = 50;
        const page = Math.min(options.page, Math.max(1, Math.ceil(total / pageSize)));
        const rows = db.prepare(`SELECT t.id,t.seminar_id,s.name AS seminar_name,s.event_type,t.title,t.due_date,t.status,t.important,
          t.assignee_id,u.email AS assignee_email,u.active AS assignee_active,(t.assignee_id=@actor) AS is_primary,
          EXISTS(SELECT 1 FROM task_collaborators c WHERE c.task_id=t.id AND c.user_id=@actor) AS is_collaborator,
          ${conditions.OVERDUE} AS overdue,${conditions.IMPORTANT} AS upcoming_important
          ${base} AND ${conditions[options.filter]}
          ORDER BY (t.due_date IS NULL),t.due_date,t.important DESC,t.id LIMIT @limit OFFSET @offset`)
          .all({ ...params, limit: pageSize, offset: (page - 1) * pageSize }) as {
            id: number; seminar_id: number; seminar_name: string; event_type: DashboardTask['event_type']; title: string;
            due_date: string | null; status: DashboardTask['status']; important: number; assignee_id: number | null;
            assignee_email: string | null; assignee_active: number | null; is_primary: number; is_collaborator: number;
            overdue: number; upcoming_important: number;
          }[];
        const items: DashboardTask[] = rows.map((row) => ({ id: row.id, seminar_id: row.seminar_id, seminar_name: row.seminar_name,
          event_type: row.event_type, title: row.title, due_date: row.due_date, status: row.status, important: !!row.important,
          assignee: row.assignee_id === null ? null : { id: row.assignee_id, email: row.assignee_email ?? `アカウント #${row.assignee_id}`, active: row.assignee_active === 1 },
          is_primary: !!row.is_primary, is_collaborator: !!row.is_collaborator, overdue: !!row.overdue, upcoming_important: !!row.upcoming_important }));
        const eventCount = (db.prepare('SELECT count(*) n FROM seminars').get() as { n: number }).n;
        return { as_of_date: today, through_date: through, horizon_days: options.days, event_count: eventCount,
          counts: summary, filter: options.filter, total, page, page_size: pageSize, items };
      })();
    },
  };
}
