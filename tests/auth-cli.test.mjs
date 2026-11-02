import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Database from 'better-sqlite3';

test('first-account CLI generates a private stable key and provisions users without printing credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'smile-cli-test-'));
  const env = { ...process.env, NODE_ENV: 'development', SMILE_DATA_DIR: join(directory, 'data') };
  delete env.AUTH_MFA_KEY;
  const keyScript = fileURLToPath(new URL('../scripts/setup-auth-key.mjs', import.meta.url));
  const userScript = fileURLToPath(new URL('../scripts/create-user.mjs', import.meta.url));
  const password = randomBytes(24).toString('base64url');
  let db;
  try {
    execFileSync(process.execPath, [keyScript], { cwd: directory, env, stdio: 'pipe' });
    const keyFile = join(directory, '.env.local');
    const fingerprint = () => createHash('sha256').update(readFileSync(keyFile)).digest('hex');
    const before = fingerprint();
    assert.equal(statSync(keyFile).mode & 0o777, 0o600);
    execFileSync(process.execPath, [keyScript], { cwd: directory, env, stdio: 'pipe' });
    assert.equal(fingerprint(), before);
    const output = execFileSync(process.execPath, [userScript, 'admin@example.invalid', 'admin'], {
      cwd: directory, env, input: JSON.stringify({ password }), stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8',
    });
    assert.ok(!output.includes(password));
    db = new Database(join(directory, 'data', 'seminars.db'));
    assert.equal(db.prepare('SELECT role FROM auth_users').get().role, 'admin');
    assert.equal(db.prepare('SELECT mfa_secret FROM auth_users').get().mfa_secret, null);
  } finally {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
