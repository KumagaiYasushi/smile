export type ParticipantRole = 'dental_hygienist' | 'dentist' | 'other';
export type PaymentStatus = 'unpaid' | 'paid';

export type Participant = {
  id: number;
  seminar_id: number;
  name: string;
  role: ParticipantRole;
  email: string;
  phone: string;
  payment_status: PaymentStatus;
  attended: boolean;
  receipt_number: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export const ROLE_LABELS: Record<ParticipantRole, string> = {
  dental_hygienist: '歯科衛生士',
  dentist: '歯科医師',
  other: 'その他',
};

export const PAYMENT_LABELS: Record<PaymentStatus, string> = {
  unpaid: '未入金',
  paid: '入金済',
};
