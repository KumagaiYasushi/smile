import type { StaffRole, StaffResponse } from './staff-attendance.ts';
export const ROSTER_RESPONSE_LABELS = { ATTENDING: '出席', ABSENT: '欠席', UNANSWERED: '未登録' } as const;
export type RosterResponse = keyof typeof ROSTER_RESPONSE_LABELS;
export type StaffRosterRow = {
  member_id: number; member_version: number; directory_name: string; active: boolean;
  name: string; role: StaffRole; person_id: number | null; version: number;
  responses: Record<string, StaffResponse>;
};
export type StaffRoster = { dates: string[]; rows: StaffRosterRow[] };
export function rosterColor(response: StaffResponse) {
  if (response === 'ATTENDING') return 'border-green-300 bg-green-50 text-green-700';
  if (response === 'ABSENT') return 'border-slate-300 bg-slate-100 text-slate-500';
  return 'border-slate-200 bg-white text-black';
}
