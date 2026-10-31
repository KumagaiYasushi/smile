import { eventPageStore } from './event-page';
import { getDb } from './db';
import { registrationStore } from './registration-store';

export async function registrationPageStore() {
  await eventPageStore();
  return registrationStore(getDb());
}
