import type { SocialGathering } from './social-gathering.ts';
import type { EventTimes, OccurrenceType } from './event-schedule.ts';

export const EVENT_TYPE_LABELS = {
  BASIC_COURSE: 'ベーシックコース',
  LECTURE: '講演会',
  SEMINAR: 'セミナー',
} as const;

export type EventType = keyof typeof EVENT_TYPE_LABELS;

export function isEventType(value: unknown): value is EventType {
  return typeof value === 'string' && Object.hasOwn(EVENT_TYPE_LABELS, value);
}

export const DELIVERY_METHOD_LABELS = {
  ONSITE: '現地開催',
  ONLINE: 'オンライン',
  HYBRID: '現地開催＋オンライン',
} as const;

export type DeliveryMethod = keyof typeof DELIVERY_METHOD_LABELS;

export function isDeliveryMethod(value: unknown): value is DeliveryMethod {
  return typeof value === 'string' && Object.hasOwn(DELIVERY_METHOD_LABELS, value);
}

export function deliveryMethodLabel(value: DeliveryMethod | null): string {
  return value ? DELIVERY_METHOD_LABELS[value] : '未設定';
}

export type Seminar = {
  id: number;
  event_type: EventType;
  delivery_method: DeliveryMethod | null;
  occurrence_type: OccurrenceType | null;
  event_times: EventTimes;
  lecturer_role: 'EXTERNAL_LECTURER' | 'SOCIETY_LECTURER' | null;
  social_gathering: SocialGathering;
  name: string;
  dates: string[];
  content: string;
  lecturer_name: string;
  assistant_members: string[];
  fee_dental_hygienist: number;
  fee_dentist: number;
  fee_other: number;
  target_participants: string;
  venue: string;
  venue_id: number | null;
  venue_fee: number;
  sns_announcement: string;
  lecturer_invitation_sent: boolean;
  photo_received: boolean;
  abstract_300_requested: boolean;
  abstract_800_requested: boolean;
  receipt_issued: boolean;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type SeminarInput = Omit<Seminar, 'id' | 'created_at' | 'updated_at'>;
export type SeminarSubmission = SeminarInput & { generate_tasks?: boolean; task_base_date?: string };

export const CHECKLIST_ITEMS: { key: keyof Pick<Seminar, 'lecturer_invitation_sent' | 'photo_received' | 'abstract_300_requested' | 'abstract_800_requested' | 'receipt_issued'>; label: string }[] = [
  { key: 'lecturer_invitation_sent', label: '講師依頼状' },
  { key: 'photo_received', label: '顔写真の受領' },
  { key: 'abstract_300_requested', label: '抄録（300字）依頼' },
  { key: 'abstract_800_requested', label: '抄録（800字）依頼' },
];
