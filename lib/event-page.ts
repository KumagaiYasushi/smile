import { redirect } from 'next/navigation';
import { currentIdentity } from './auth';
import { getDb } from './db';
import { EventStore } from './event-store';
export async function eventPageStore() {
  if (!await currentIdentity()) redirect('/login');
  return new EventStore(getDb());
}
