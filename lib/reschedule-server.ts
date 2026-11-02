import { getDb } from '@/lib/db';
import { createRescheduleStore } from '@/lib/reschedule';

export const rescheduleStore = () => createRescheduleStore(getDb());
