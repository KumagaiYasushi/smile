import type Database from 'better-sqlite3';
import { createSocietyMemberStore } from './society-members.ts';
import { createEventRoleStore } from './event-roles.ts';
import { createStaffRosterStore } from './staff-roster.ts';
import { createTaskStore } from './tasks.ts';
import { createTaskRoleLinkStore } from './task-role-links.ts';
import { PREPARATION_ROLES, EVENT_DAY_ROLES, EVENT_ROLES } from '../types/event-roles.ts';
import type { EventRoleKey, EventDayRoleKey } from '../types/event-roles.ts';
import { attendanceDateKeys } from '../types/staff-attendance.ts';
import { speakerAttendanceWarning, eventSpeakers } from '../types/speaker.ts';
import { TaskError, todayInTokyo, isTaskOverdue } from '../types/task.ts';
import type { Seminar } from '../types/seminar.ts';
import type { MemberPageData, MemberEvent, MemberRole, MemberAlert, TaskRoleLink } from '../types/member-page.ts';

type EventRow = { id: number; name: string; event_type: Seminar['event_type']; dates: string; speakers: string | null;
  lecturer_name: string; lecturer_role: Seminar['lecturer_role']; external_lecturer: string };
export function createMemberPageStore(db: Database.Database) {
  const directory = createSocietyMemberStore(db), roles = createEventRoleStore(db), roster = createStaffRosterStore(db);
  const tasks = createTaskStore(db), links = createTaskRoleLinkStore(db);
  function activeActor(actorId: number) {
    if (!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId)) throw new TaskError('ログインが必要です', 403);
  }
  function member(memberId: number) {
    const person = directory.list().find(p => p.id === memberId && p.active);
    if (!person) throw new TaskError('有効な研究会メンバーを選択してください', 404);
    return person;
  }
  function event(eventId: number) {
    const row = db.prepare('SELECT id,name,event_type,dates,speakers,lecturer_name,lecturer_role,external_lecturer FROM seminars WHERE id=?').get(eventId) as EventRow | undefined;
    if (!row) throw new TaskError('イベントが見つかりません', 404);
    return { ...row, dates: JSON.parse(row.dates) as string[], speakers: row.speakers === null ? null : JSON.parse(row.speakers), external_lecturer: JSON.parse(row.external_lecturer) };
  }
  function ownRoles(eventId: number, memberId: number): MemberRole[] {
    const data = roles.read(eventId), result: MemberRole[] = [];
    for (const role of Object.keys(PREPARATION_ROLES) as EventRoleKey[]) {
      if (data.assignments[role].some(p => p.member_id === memberId)) result.push({ role, date: null });
    }
    for (const date of attendanceDateKeys(data.attendance!.dates)) for (const role of Object.keys(EVENT_DAY_ROLES) as EventDayRoleKey[]) {
      if (data.day_assignments?.[date]?.[role].some(p => p.member_id === memberId)) result.push({ role, date });
    }
    return result;
  }
  function matches(link: TaskRoleLink, assigned: MemberRole[]) {
    return link.role !== null && assigned.some(p => p.role === link.role && (link.date === null || link.date === p.date));
  }
  return {
    read(memberId: number | null, actorId: number, today = todayInTokyo()): MemberPageData {
      activeActor(actorId);
      return db.transaction(() => {
        const people = directory.list().filter(p => p.active);
        if (memberId === null) return { members: people, member: null, events: [], today };
        const person = member(memberId);
        const upcomingEnd = new Date(`${today}T00:00:00Z`); upcomingEnd.setUTCDate(upcomingEnd.getUTCDate() + 7);
        const soon = upcomingEnd.toISOString().slice(0, 10);
        const events = (db.prepare('SELECT id FROM seminars').all() as { id: number }[]).map(({ id }): MemberEvent => {
          const row = event(id), assigned = ownRoles(id, memberId), attendance = roster.list(id).rows.find(p => p.member_id === memberId)!;
          const past = row.dates.length > 0 && row.dates.every(d => d < today);
          const roleLinks = links.list(id);
          const mine = tasks.listTasks(id).flatMap(task => {
            const link = roleLinks.find(p => p.task_id === task.id);
            return link && matches(link, assigned) ? [{ ...task, role_link: link, overdue: isTaskOverdue(task, today),
              due_soon: task.status !== 'DONE' && task.due_date !== null && task.due_date >= today && task.due_date <= soon }] : [];
          });
          const speakers = eventSpeakers(row), alerts: MemberAlert[] = [];
          for (const task of mine) {
            if (task.overdue) alerts.push({ kind: 'OVERDUE', text: `期限超過：${task.title}（${task.due_date}）` });
            else if (task.due_soon) alerts.push({ kind: 'DUE_SOON', text: `7日以内の期限：${task.title}（${task.due_date}）` });
          }
          for (const date of attendanceDateKeys(row.dates).filter(d => !d || d >= today)) {
            const response = attendance.responses[date] ?? 'UNANSWERED', label = date || '日程未定';
            if (response === 'UNANSWERED' || response === 'TENTATIVE') alerts.push({ kind: 'UNANSWERED', text: `${label}：出欠が未確定です` });
            const dayRoles = assigned.filter(p => p.date === date);
            if (response === 'ABSENT' && dayRoles.length) alerts.push({ kind: 'ROLE_ABSENCE', text: `${label}：欠席ですが${dayRoles.map(p => EVENT_ROLES[p.role]).join('・')}に割り当てられています。運営へ担当変更をご相談ください。` });
            if (speakerAttendanceWarning(speakers, attendance, date, response)) alerts.push({ kind: 'SPEAKER_ATTENDANCE', text: `${label}：演者登録と出欠を確認してください` });
          }
          const speakingDates = attendanceDateKeys(row.dates).filter(date => speakerAttendanceWarning(speakers, attendance, date, 'ABSENT') !== null);
          return { id, name: row.name, event_type: row.event_type, dates: row.dates, attendance, roles: assigned, tasks: mine, alerts, past, speaking_dates: speakingDates, role_version: roles.read(id).version };
        }).sort((a, b) => (a.dates[0] || '9999').localeCompare(b.dates[0] || '9999') || a.id - b.id);
        return { members: people, member: person, events, today };
      })();
    },
    setAttendance(memberId: number, eventId: number, value: unknown, actorId: number) {
      return db.transaction(() => {
        activeActor(actorId); member(memberId);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('出欠の入力形式が不正です');
        const p = value as Record<string, unknown>;
        if (Object.keys(p).some(k => !['member_version', 'version', 'date', 'response', 'schedule', 'confirm_speaker'].includes(k))) throw new TaskError('変更できない項目が含まれています');
        if (p.confirm_speaker !== undefined && typeof p.confirm_speaker !== 'boolean') throw new TaskError('演者の出欠確認が不正です');
        const row = roster.list(eventId).rows.find(p => p.member_id === memberId)!;
        const warning = speakerAttendanceWarning(eventSpeakers(event(eventId)), row, String(p.date), String(p.response));
        if (warning && p.confirm_speaker !== true) throw new TaskError(warning, 409);
        const { confirm_speaker: _confirmation, ...input } = p;
        void _confirmation;
        roster.setResponse(eventId, { ...input, member_id: memberId }, actorId);
      }).immediate();
    },
    setTaskStatus(memberId: number, eventId: number, taskId: number, value: unknown, actorId: number) {
      return db.transaction(() => {
        activeActor(actorId); member(memberId);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('進捗の入力形式が不正です');
        const p = value as Record<string, unknown>;
        if (Object.keys(p).some(k => !['status', 'version', 'link_version', 'role_version'].includes(k))) throw new TaskError('個人ページから変更できるのはタスク進捗のみです');
        const link = links.read(eventId, taskId), roleData = roles.read(eventId);
        if (p.link_version !== link.version || p.role_version !== roleData.version) throw new TaskError('役割またはタスク連動が変更されています。最新情報を取得してください', 409);
        if (!matches(link, ownRoles(eventId, memberId))) throw new TaskError('このメンバーの役割に連動したタスクではありません', 403);
        return tasks.updateTask(eventId, taskId, { status: p.status }, p.version as number, actorId);
      }).immediate();
    },
  };
}
