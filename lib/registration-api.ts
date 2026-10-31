import { eventApi } from './event-api.ts';
import { getDb } from './db.ts';
import { registrationStore, type RegistrationStore } from './registration-store.ts';

export function registrationApi(request: Request, run: (store: RegistrationStore, actor: number) => unknown | Promise<unknown>, status = 200) {
  return eventApi(request, (_events, actor) => run(registrationStore(getDb()), actor), status);
}
