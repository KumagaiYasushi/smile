export const STAFF_ROLE_LABELS = { LECTURER: '講師', SUPPORT: 'サポートメンバー' } as const;
export const STAFF_RESPONSE_LABELS = {
  UNANSWERED: '未回答', ATTENDING: '出席予定', ABSENT: '欠席予定', TENTATIVE: '調整中',
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
