import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { AuthStore } from './auth-store.ts';
import { getDb } from './db.ts';
import { developmentDirectory } from './development.ts';

export function authStore() {
  const dir = developmentDirectory();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(dir, 'auth.key');
  try { writeFileSync(keyPath, randomBytes(32), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  return new AuthStore(getDb(), readFileSync(keyPath));
}
