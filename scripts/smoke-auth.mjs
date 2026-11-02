import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { createAuthStore, totpCode } from '../lib/auth.ts';
import { smokeEventTypes } from './smoke-event-types.mjs';
import { smokeTasks } from './smoke-tasks.mjs';
import { smokeTemplates } from './smoke-templates.mjs';
import { smokeReschedule } from './smoke-reschedule.mjs';
import { smokeDashboard } from './smoke-dashboard.mjs';
import { smokeStaffAttendance } from './smoke-staff-attendance.mjs';
import { smokeSocialGathering } from './smoke-social-gathering.mjs';
import { smokeLunch } from './smoke-lunch.mjs';
import { smokeVenues } from './smoke-venues.mjs';
import { smokeSettingsReceipts } from './smoke-settings-receipts.mjs';
import { smokeSessionDirectory } from './smoke-session-directory.mjs';
import { smokeEventRegistration } from './smoke-event-registration.mjs';
import { smokeExternalLunch } from './smoke-external-lunch.mjs';
import { smokeEventDetails } from './smoke-event-details.mjs';

// All credentials are generated for this run. Nothing is written to the app's data/ or env files.
const directory = mkdtempSync(join(tmpdir(), 'smile-auth-smoke-'));
const encryptionKey = randomBytes(32).toString('hex');
const password = randomBytes(24).toString('base64url');
const base = 'http://127.0.0.1:3100';
let server;
let db;
let logs = '';
function client() {
  const jar = new Map();
  return {
    cookie: () => [...jar].map(([key, value]) => `${key}=${value}`).join('; '),
    async request(path, method = 'GET', body, status = 200, extraHeaders = {}) {
      const response = await fetch(`${base}${path}`, {
        method, redirect: 'manual', headers: { Origin: base, 'Content-Type': 'application/json',
          Cookie: this.cookie(), ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      assert.equal(response.status, status, `${method} ${path}`);
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(';')[0];
        const index = pair.indexOf('=');
        const key = pair.slice(0, index), value = pair.slice(index + 1);
        if (value) jar.set(key, value); else jar.delete(key);
      }
      return response;
    },
  };
}

try {
  db = new Database(join(directory, 'seminars.db'));
  const auth = createAuthStore(db, encryptionKey);
  await auth.createUser('member@example.invalid', password, 'member');
  await auth.createUser('admin@example.invalid', password, 'admin');
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3100'], {
    cwd: process.cwd(), env: { ...process.env, SMILE_DATA_DIR: directory, AUTH_MFA_KEY: encryptionKey, APP_ORIGIN: base },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-4000); });
  server.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-4000); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Test server failed to start');
    if (logs.includes('Ready in')) { ready = true; break; }
    await delay(100);
  }
  assert.ok(ready, 'isolated server readiness');
  const guest = client();
  await guest.request('/login');
  for (const path of ['/', '/dashboard', '/seminars/new', '/seminars/1', '/seminars/1/edit', '/seminars/1/participants', '/seminars/1/email-templates', '/seminars/1/participants/1/receipt', '/seminars/1/tasks', '/seminars/1/reschedule', '/seminars/1/staff-attendance', '/seminars/1/lunch', '/task-templates', '/venues', '/society-members', '/external-lecturers', '/admin/users']) {
    const response = await guest.request(path, 'GET', undefined, 307);
    assert.ok(response.headers.get('location').endsWith('/login'));
  }
  for (const [path, methods] of [
    ['/api/seminars', ['GET', 'POST']], ['/api/seminars/1', ['GET', 'PATCH', 'DELETE']],
    ['/api/seminars/1/participants', ['GET', 'POST']], ['/api/seminars/1/participants/1', ['GET', 'PATCH', 'DELETE']],
    ['/api/admin/users', ['GET', 'POST']], ['/api/auth/me', ['GET']],
    ['/api/members', ['GET']], ['/api/seminars/1/tasks', ['GET', 'POST']],
    ['/api/seminars/1/tasks/1', ['GET', 'PATCH', 'DELETE']],
    ['/api/task-templates', ['GET', 'POST']], ['/api/task-templates/1', ['PATCH']],
    ['/api/seminars/1/tasks/template-preview', ['POST']], ['/api/seminars/1/tasks/apply-templates', ['POST']],
    ['/api/seminars/1/schedule-preview', ['POST']], ['/api/seminars/1/reschedule', ['POST']], ['/api/seminars/1/schedule-history', ['GET']],
    ['/api/dashboard', ['GET']],
    ['/api/seminars/1/staff-attendance', ['GET', 'POST']],
    ['/api/seminars/1/staff-attendance/1', ['PATCH', 'DELETE']],
    ['/api/seminars/1/staff-attendance/import', ['POST']],
    ['/api/seminars/1/staff-attendance/roster', ['POST']],
    ['/api/seminars/1/lunch', ['GET', 'POST']], ['/api/seminars/1/lunch/1', ['PATCH', 'DELETE']],
    ['/api/seminars/1/participants/1/receipt', ['GET', 'POST']],
    ['/api/society-members', ['GET', 'POST']], ['/api/society-members/1', ['PATCH']],
    ['/api/external-lecturers', ['GET', 'POST']], ['/api/external-lecturers/1', ['PATCH']],
    ['/api/venues', ['GET', 'POST']], ['/api/venues/1', ['GET', 'PATCH']],
  ]) {
    for (const method of methods) await guest.request(path, method, method === 'GET' ? undefined : {}, 401);
  }
  await guest.request('/api/auth/login', 'POST', { email: 'member@example.invalid', password }, 403, { Origin: 'https://untrusted.invalid' });
  await guest.request('/api/auth/login', 'POST', { email: 'member@example.invalid', password: 'incorrect' }, 401);
  await guest.request('/api/auth/login', 'POST', { email: 'member@example.invalid', password });
  const member = guest;
  await member.request('/verification', 'GET', undefined, 404);
  assert.equal((await (await member.request('/api/auth/me')).json()).user.role, 'member');
  await member.request('/api/admin/users', 'GET', undefined, 403);
  await member.request('/api/admin/users', 'POST', { email: 'extra@example.invalid', password, role: 'admin' }, 403);
  await member.request('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: 'rejected' }, 403, { Origin: 'https://untrusted.invalid' });
  await smokeEventTypes(base, member.cookie());
  await smokeTasks(member);
  await smokeTemplates(member);
  await smokeReschedule(member,db);
  await smokeDashboard(member);
  await smokeStaffAttendance(member);
  await smokeSocialGathering(member);
  await smokeLunch(member);
  await smokeVenues(member);
  await smokeSettingsReceipts(member);
  await smokeSessionDirectory(member);
  assert.equal(db.prepare('SELECT count(*) n FROM event_lunch_plans').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM event_lunch_history').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM event_staff').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM event_staff_history').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM event_tasks').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM task_collaborators').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM task_template_applications').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM task_generation_batches').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM event_schedule_state').get().n, 0);
  await smokeEventRegistration(member);
  await smokeExternalLunch(member);
  await smokeEventDetails(member);
  const seminar = await (await member.request('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: '架空認証検証' }, 201)).json();
  const participant = await (await member.request(`/api/seminars/${seminar.id}/participants`, 'POST', { name: '架空参加者' }, 201)).json();
  const correct = `/api/seminars/${seminar.id}/participants/${participant.id}`;
  const incorrect = `/api/seminars/${seminar.id + 999}/participants/${participant.id}`;
  for (const method of ['GET', 'PATCH', 'DELETE']) {
    await member.request(incorrect, method, method === 'PATCH' ? { name: 'bad' } : undefined, 404);
  }
  assert.equal((await (await member.request(correct, 'PATCH', { payment_status: 'paid', paid_amount: 5000 })).json()).payment_status, 'paid');
  await member.request(correct, 'DELETE');
  await member.request(`/api/seminars/${seminar.id}`, 'DELETE');
  const oldCookie = member.cookie();
  await member.request('/api/auth/logout', 'POST');
  await member.request('/api/seminars', 'GET', undefined, 401, { Cookie: oldCookie });
  await member.request('/api/dashboard', 'GET', undefined, 401, { Cookie: oldCookie });
  const admin = client();
  const first = await admin.request('/api/auth/login', 'POST', { email: 'admin@example.invalid', password });
  const setup = await first.json();
  assert.equal(setup.stage, 'setup');
  assert.match(first.headers.get('set-cookie'), /HttpOnly/i);
  assert.match(first.headers.get('set-cookie'), /SameSite=Strict/i);
  assert.match(first.headers.get('set-cookie'), /Secure/i);
  assert.equal(first.headers.get('cache-control'), 'no-store');
  await admin.request('/api/seminars', 'GET', undefined, 401);
  await admin.request('/api/admin/users', 'GET', undefined, 401);
  await admin.request('/api/auth/mfa', 'POST', { code: 'invalid' }, 401);
  await admin.request('/api/auth/mfa', 'POST', { code: totpCode(setup.secret) });
  await admin.request('/admin/users');
  const users = await (await admin.request('/api/admin/users')).json();
  assert.equal(users.users.length, 2);
  assert.ok(!JSON.stringify(users).includes('password_hash'));
  assert.ok(!JSON.stringify(users).includes(setup.secret));
  await admin.request('/api/admin/users', 'POST', { email: 'another@example.invalid', password, role: 'member' }, 201);
  await admin.request('/api/auth/logout', 'POST');
  const second = await (await admin.request('/api/auth/login', 'POST', { email: 'admin@example.invalid', password })).json();
  assert.equal(second.stage, 'mfa');
  assert.equal(second.secret, null);
  const step = db.prepare("SELECT last_totp_step FROM auth_users WHERE role='admin'").get().last_totp_step;
  await admin.request('/api/auth/mfa', 'POST', { code: totpCode(setup.secret, step * 30) }, 401);
  await admin.request('/api/auth/mfa', 'POST', { code: totpCode(setup.secret, (step + 1) * 30) });
  assert.equal((await (await admin.request('/api/auth/me')).json()).user.role, 'admin');
  assert.equal(db.prepare('SELECT count(*) n FROM seminars').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM participants').get().n, 0);
  console.log('PASS: all protected pages/APIs deny guests; member/admin permissions; CSRF; MFA setup, login and replay rejection; cookie flags; logout revocation; participant scope; authenticated event regression');
} finally {
  if (server && server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill('SIGTERM');
    await stopped;
  }
  db?.close();
  rmSync(directory, { recursive: true, force: true });
}
