export const STAFF_SELECTABLE_ROLE_LABELS = { EXTERNAL_LECTURER: '外来講師', SOCIETY_LECTURER: '研究会講師', SOCIETY_SUPPORT: '研究会サポートメンバー' } as const;
export const STAFF_ROLE_LABELS = { ...STAFF_SELECTABLE_ROLE_LABELS, LECTURER: '講師（旧区分・未設定）', SUPPORT: 'サポート（旧区分）' } as const;
export const STAFF_RESPONSE_LABELS = {
  UNANSWERED: '未回答', ATTENDING: '出席予定', AM_ONLY: '午前のみ', PM_ONLY: '午後のみ', ABSENT: '欠席予定', TENTATIVE: '調整中',
} as const;
export type StaffRole = keyof typeof STAFF_ROLE_LABELS;
export type StaffResponse = keyof typeof STAFF_RESPONSE_LABELS;
export type StaffPerson = {
  id: number; seminar_id: number; name: string; role: StaffRole;
  responses: Record<string, StaffResponse>; version: number; updated_at: string;
};
export type StaffAttendance = {
  event_name: string; dates: string[]; people: StaffPerson[];
};
export type StaffInput = Pick<StaffPerson, 'name' | 'role' | 'responses'> & { schedule: string[] };
export type StaffHistory = {
  id: number; person_id: number; actor_id: number; action: 'created' | 'updated' | 'deleted';
  before: { role: StaffRole; responses: Record<string, StaffResponse> } | null;
  after: { role: StaffRole; responses: Record<string, StaffResponse> } | null;
  occurred_at: string;
};

export const attendanceDateLabel = (date: string) => date || '日程未定';
export const attendanceDateKeys = (dates: string[]) => dates.length ? dates : [''];

export function isStaffAttending(response: StaffResponse | undefined) {
  return response === 'ATTENDING' || response === 'AM_ONLY' || response === 'PM_ONLY';
}
