import type { SocietyMember } from './society-member.ts';
import type { EventRoleKey } from './event-roles.ts';
import type { EventTask } from './task.ts';
import type { StaffRosterRow } from './staff-roster.ts';
import type { EventType } from './seminar.ts';

export type TaskRoleLink = { task_id: number; role: EventRoleKey | null; date: string | null; version: number };
export type MemberRole = { role: EventRoleKey; date: string | null };
export type MemberTask = EventTask & { role_link: TaskRoleLink; overdue: boolean; due_soon: boolean };
export type MemberAlert = { kind: 'OVERDUE' | 'DUE_SOON' | 'UNANSWERED' | 'ROLE_ABSENCE' | 'SPEAKER_ATTENDANCE'; text: string };
export type MemberEvent = {
  id: number; name: string; event_type: EventType; dates: string[];
  attendance: StaffRosterRow; roles: MemberRole[]; tasks: MemberTask[]; alerts: MemberAlert[]; past: boolean;
  speaking_dates: string[]; role_version: number;
};
export type MemberPageData = { members: SocietyMember[]; member: SocietyMember | null; events: MemberEvent[]; today: string };
