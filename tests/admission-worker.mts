import { parentPort, workerData } from 'node:worker_threads';
import Database from 'better-sqlite3';
import { RegistrationStore } from '../lib/registration-store.ts';
import { EventError } from '../lib/event-store.ts';

const db = new Database(workerData.path);
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
const store = new RegistrationStore(db);
parentPort!.postMessage({ ready: true });
parentPort!.once('message', () => {
  try {
    store.confirm(workerData.id, { reviewed: true, event_version: 1 }, 1);
    parentPort!.postMessage({ status: 200 });
  } catch (error) {
    parentPort!.postMessage({ status: error instanceof EventError ? error.status : 500 });
  } finally { db.close(); parentPort!.close(); }
});
