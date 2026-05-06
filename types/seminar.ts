export type Seminar = {
  id: number;
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

export const CHECKLIST_ITEMS: { key: keyof Pick<Seminar, 'lecturer_invitation_sent' | 'photo_received' | 'abstract_300_requested' | 'abstract_800_requested' | 'receipt_issued'>; label: string }[] = [
  { key: 'lecturer_invitation_sent', label: '講師依頼状' },
  { key: 'photo_received', label: '顔写真の受領' },
  { key: 'abstract_300_requested', label: '抄録（300字）依頼' },
  { key: 'abstract_800_requested', label: '抄録（800字）依頼' },
  { key: 'receipt_issued', label: '領収書発行' },
];
