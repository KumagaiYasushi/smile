import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const directory = mkdtempSync(join(tmpdir(), 'smile-hosted-check-'));
const password = randomBytes(24).toString('base64url');
const base = 'http://localhost:3302', origin = 'https://verification.example.invalid';
let server, logs = '';
try {
  server = spawn(process.execPath, ['scripts/start-hosted-verification.mjs'], {
    env: { ...process.env, PORT: '3302', SMILE_VERIFICATION_EMAIL: 'verifier@example.invalid', SMILE_VERIFICATION_PASSWORD: password,
      RENDER_EXTERNAL_URL: origin, SMILE_VERIFICATION_ORIGIN: origin, SMILE_VERIFICATION_DATA_DIR: directory, SMILE_VERIFICATION_EPHEMERAL: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => { logs = (logs + chunk).slice(-2000); });
  server.stderr.on('data', chunk => { logs = (logs + chunk).slice(-2000); });
  for (let attempt = 0; attempt < 300 && !logs.includes('Ready in'); attempt++) {
    if (server.exitCode !== null) throw new Error('hosted startup failed');
    await delay(100);
  }
  assert.ok(logs.includes('Ready in'));
  assert.ok(!logs.includes(password));
  assert.equal((await fetch(`${base}/login`)).status, 200);
  assert.equal((await fetch(`${base}/api/seminars`)).status, 401);
  const login = async requestOrigin => fetch(`${base}/api/auth/login`, { method: 'POST',
    headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'verifier@example.invalid', password }),
  });
  assert.equal((await login(base)).status, 403);
  const authenticated = await login(origin);
  assert.equal(authenticated.status, 200);
  const cookie = authenticated.headers.get('set-cookie');
  assert.match(cookie, /Secure/); assert.match(cookie, /HttpOnly/);
  const headers = { Cookie: cookie.split(';')[0], Origin: origin };
  const guide = await fetch(`${base}/verification`, { headers });
  assert.equal(guide.status, 200);
  const html = await guide.text();
  assert.ok(html.includes('操作検証ページ')); assert.ok(html.includes('一時保存'));
  const events = await (await fetch(`${base}/api/seminars`, { headers })).json();
  assert.equal(events.length, 3);
  for (const event of events) {
    const result = await (await fetch(`${base}/api/seminars/${event.id}/lunch`, { headers })).json();
    assert.ok(result.plans.some(plan => plan.target === 'EXTERNAL_LECTURER'));
  }
  console.log('PASS: hosted bootstrap, production startup, isolated samples, HTTPS-origin CSRF checks, Secure cookies and ephemeral-data notice');
} catch {
  console.error('FAIL: 公開用起動の確認に失敗しました。資格情報を含むログは表示していません'); process.exitCode = 1;
} finally {
  if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
  rmSync(directory, { recursive: true, force: true });
}
