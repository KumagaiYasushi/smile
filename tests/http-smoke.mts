import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { rmSync } from 'node:fs';
import { developmentDirectory } from '../lib/development.ts';
import { totp } from '../lib/auth-store.ts';

process.env.SMILE_ENV = 'test';
process.env.SMILE_TEST_RUN = randomBytes(8).toString('hex');
const directory = developmentDirectory();
const password = randomBytes(24).toString('hex');
const provision = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/create-dev-admin.ts'], {
  env: { ...process.env, SMILE_DEV_EMAIL: 'smoke@example.invalid', SMILE_DEV_NAME: '架空の試験管理者', SMILE_DEV_PASSWORD: password },
  encoding: 'utf8',
});
assert.equal(provision.status, 0, 'development admin provisioning CLI succeeds');
const base = 'http://127.0.0.1:3107';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3107'], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', data => { output += data.toString(); });
server.stderr.on('data', data => { output += data.toString(); });
const jar = new Map<string, string>();

async function request(path: string, method = 'GET', body?: object, cookie = true, origin = base) {
  const response = await fetch(base + path, {
    method, redirect: 'manual', headers: {
      ...(cookie ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
      origin, 'Content-Type': 'application/json',
    }, body: body ? JSON.stringify(body) : undefined,
  });
  if (cookie) for (const header of response.headers.getSetCookie()) {
    const [key, value] = header.split(';')[0].split('=');
    jar.set(key, value);
  }
  return response;
}

try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    try { if ((await fetch(base + '/login')).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready, 'test server becomes ready');
  for (const path of ['/', '/events', '/events/new', '/events/1', '/task-templates', '/participants', '/participants/1', '/events/1/registrations', '/seminars', '/seminars/new', '/seminars/1/participants/1/receipt']) {
    const r = await request(path);
    assert.equal(r.status, 307, path);
    assert.equal(new URL(r.headers.get('location')!, base).pathname, '/login');
  }
  for (const path of ['/api/seminars', '/api/seminars/1', '/api/seminars/1/participants', '/api/seminars/1/participants/1']) {
    for (const method of path === '/api/seminars' || path.endsWith('/participants') ? ['GET', 'POST'] : ['GET', 'PATCH', 'DELETE']) {
      assert.equal((await request(path, method, method === 'GET' ? undefined : {})).status, 401, `${method} ${path}`);
    }
  }
  for (const [path, method] of [
    ['/api/events', 'GET'], ['/api/events', 'POST'], ['/api/events/1', 'GET'], ['/api/events/1', 'PATCH'],
    ['/api/events/1/tasks', 'GET'], ['/api/events/1/tasks', 'POST'], ['/api/events/1/history', 'GET'],
    ['/api/events/1/schedule-preview', 'POST'], ['/api/tasks/1', 'PATCH'], ['/api/members', 'GET'],
    ['/api/events/1/admission', 'GET'], ['/api/events/1/admission', 'PATCH'], ['/api/registrations/1/confirm', 'POST'],
    ['/api/participants', 'GET'], ['/api/participants/search', 'POST'], ['/api/participants/1', 'GET'], ['/api/participants/1', 'PATCH'],
    ['/api/events/1/registrations', 'GET'], ['/api/events/1/registrations', 'POST'],
    ['/api/task-templates', 'GET'], ['/api/task-templates', 'POST'], ['/api/task-templates/1', 'PATCH'],
  ]) assert.equal((await request(path, method, method === 'GET' ? undefined : {})).status, 401, `${method} ${path}`);
  assert.equal((await request('/api/auth/login', 'POST', { email: 'smoke@example.invalid', password }, true, 'https://foreign.invalid')).status, 403);
  assert.equal((await request('/api/auth/login', 'POST', { email: 'smoke@example.invalid', password: 'wrong' })).status, 401);
  const login = await request('/api/auth/login', 'POST', { email: 'smoke@example.invalid', password });
  assert.equal(login.status, 200);
  assert.equal(login.headers.get('cache-control'), 'no-store');
  assert(login.headers.get('set-cookie')?.includes('HttpOnly'));
  const challenge = await login.json();
  assert(challenge.setupSecret);
  assert.equal((await request('/api/seminars')).status, 401, 'password alone is insufficient');
  assert.equal((await request('/api/auth/mfa', 'POST', { code: 'invalid' })).status, 401);
  const mfa = await request('/api/auth/mfa', 'POST', { code: totp(challenge.setupSecret) });
  assert.equal(mfa.status, 200);
  assert(mfa.headers.get('set-cookie')?.includes('SameSite=strict'));
  assert((await (await request('/')).text()).includes('企画運営ホーム'));
  assert.equal((await request('/seminars')).status, 200);
  assert.equal((await request('/api/seminars', 'POST', {}, true, 'https://foreign.invalid')).status, 403);
  const created = await request('/api/seminars', 'POST', { name: '架空の確認セミナー', dates: ['2027-01-10'] });
  assert.equal(created.status, 201);
  const seminar = await created.json();
  assert.equal((await request(`/api/seminars/${seminar.id}`, 'PATCH', { venue: '架空会場' })).status, 200);
  const participantResponse = await request(`/api/seminars/${seminar.id}/participants`, 'POST', { name: '架空参加者' });
  assert.equal(participantResponse.status, 201);
  const participant = await participantResponse.json();
  assert.equal((await request(`/api/seminars/${seminar.id}/participants/${participant.id}`, 'PATCH', { attended: true })).status, 200);
  assert.equal((await request(`/api/seminars/${seminar.id}/participants/${participant.id}`)).status, 200);
  assert.equal((await request(`/api/seminars/${seminar.id}/participants/${participant.id}`, 'DELETE')).status, 200);
  assert.equal((await request(`/api/seminars/${seminar.id}`, 'DELETE')).status, 200);
  const memberResponse = await request('/api/members'); assert.equal(memberResponse.status, 200);
  const members = await memberResponse.json(); assert.equal(members.length, 1); assert(!('email' in members[0]));
  const templateInput = { family: 'BASIC_COURSE', title: '架空の案内準備', relative_days: -30, phase: 'PREPARATION', important: true, active: true };
  const templateResponse = await request('/api/task-templates', 'POST', templateInput);
  assert.equal(templateResponse.status, 201); const template = await templateResponse.json();
  const eventInput = { type: 'BASIC_COURSE', title: '架空の連続コース', owner_id: members[0].id, sessions: [
    { starts_at: '2028-03-01T10:00+09:00', ends_at: '2028-03-01T17:00+09:00' },
    { starts_at: '2028-04-01T10:00+09:00', ends_at: '2028-04-01T17:00+09:00' },
  ] };
  assert.equal((await request('/api/events', 'POST', eventInput, true, 'https://foreign.invalid')).status, 403);
  assert.equal((await request('/api/events', 'POST', { ...eventInput, owner_id: 999 })).status, 400);
  const createdEvent = await request('/api/events', 'POST', eventInput); assert.equal(createdEvent.status, 201);
  const course = await createdEvent.json(); assert.equal(course.sessions.length, 2); assert.equal(course.tasks[0].due_on, '2028-01-31');
  const eventId = course.id, task = course.tasks[0];
  assert.equal((await request('/api/events')).status, 200);
  const changedTask = await request(`/api/tasks/${task.id}`, 'PATCH', { version: task.version, status: 'REVIEW', assignee_id: members[0].id, collaborator_ids: [], important: false, due_on: '2028-02-01' });
  assert.equal(changedTask.status, 200); assert.equal((await changedTask.json()).due_mode, 'MANUAL');
  assert.equal((await request(`/api/tasks/${task.id}`, 'PATCH', { version: task.version, status: 'DONE' })).status, 409);
  assert.equal((await request(`/api/events/${eventId}/tasks`, 'POST', { title: '架空の個別作業', due_on: '2028-03-01', phase: 'DAY', important: false })).status, 200);
  assert.equal((await request(`/api/events/${eventId}`, 'PATCH', { version: course.version, owner_id: members[0].id })).status, 200);
  assert.equal((await request(`/api/events/${eventId}`, 'PATCH', { version: 2, sessions: course.sessions, owner_id: members[0].id })).status, 400);
  const beforePreview = await (await request(`/api/events/${eventId}`)).json();
  const previewResponse = await request(`/api/events/${eventId}/schedule-preview`, 'POST', { sessions: [
    { starts_at: '2028-03-11T10:00+09:00', ends_at: '2028-03-11T17:00+09:00' },
  ] });
  assert.equal(previewResponse.status, 200); assert.equal((await previewResponse.json()).can_apply, false);
  assert.deepEqual(await (await request(`/api/events/${eventId}`)).json(), beforePreview);
  assert.equal((await request(`/api/events/${eventId}/history`)).status, 200);
  assert.equal((await request(`/api/events/${eventId}/tasks`)).status, 200);
  assert.equal((await request(`/api/task-templates/${template.id}`, 'PATCH', { ...templateInput, relative_days: -7, version: template.version })).status, 200);
  assert.equal((await request(`/api/task-templates/${template.id}`, 'PATCH', { ...templateInput, version: template.version })).status, 409);
  const snapshot = { name: '架空の横断参加者', mobile: '000-0000-0000', email: 'person@example.invalid', workplace: '架空の旧勤務先' };
  const registrationInput = { request_key: randomUUID(), snapshot };
  const registrationsPath = `/api/events/${eventId}/registrations`;
  assert.equal((await request(registrationsPath, 'POST', registrationInput, true, 'https://foreign.invalid')).status, 403);
  assert.equal((await request(registrationsPath, 'POST', { ...registrationInput, attended: true })).status, 400);
  const registrationResponse = await request(registrationsPath, 'POST', registrationInput);
  assert.equal(registrationResponse.status, 201); const registration = await registrationResponse.json();
  assert.equal(registration.application_status, 'PENDING_REVIEW'); assert.equal(registration.attendance_status, 'UNVERIFIED');
  assert.deepEqual(await (await request(registrationsPath, 'POST', registrationInput)).json(), registration);
  assert.equal((await (await request(registrationsPath)).json()).length, 1);
  assert.equal((await request(registrationsPath, 'POST', { ...registrationInput, snapshot: { ...snapshot, name: '別内容' } })).status, 409);
  const secondEventResponse = await request('/api/events', 'POST', { ...eventInput, title: '架空イベントB' });
  assert.equal(secondEventResponse.status, 201); const secondEvent = await secondEventResponse.json();
  const cross = await request(`/api/events/${secondEvent.id}/registrations`, 'POST', { request_key: randomUUID(), snapshot: { ...snapshot, email: 'new@example.invalid' } });
  assert.equal(cross.status, 201); const secondRegistration = await cross.json();
  assert.equal(secondRegistration.participant_id, registration.participant_id); assert.equal(secondRegistration.match_status, 'EXACT');
  const participantPath = `/api/participants/${registration.participant_id}`;
  const detail = await (await request(participantPath)).json(); assert.equal(detail.current_email, snapshot.email); assert.equal(detail.registrations.length, 2);
  const replacement = { ...snapshot, mobile: '000-9999-9999', email: 'edited@example.invalid', workplace: '架空の新勤務先' };
  assert.equal((await request(participantPath, 'PATCH', { version: 1, contact: replacement }, true, 'https://foreign.invalid')).status, 403);
  assert.equal((await request(participantPath, 'PATCH', { version: 1, contact: replacement })).status, 200);
  assert.equal((await request(participantPath, 'PATCH', { version: 1, contact: snapshot })).status, 409);
  const revised = await (await request(participantPath)).json();
  assert.equal(revised.revisions.length, 2); assert.deepEqual(revised.revisions[0].before, snapshot);
  assert.deepEqual(revised.registrations.find((row: { id: number }) => row.id === registration.id).snapshot, snapshot);
  const searchResponse = await request('/api/participants/search', 'POST', { query: '新勤務先', page: 1 });
  assert.equal(searchResponse.status, 200); assert.equal((await searchResponse.json()).total, 1);
  assert.equal((await request('/api/participants?page=0')).status, 400);
  assert.equal((await request('/api/participants/999')).status, 404);
  assert.equal((await request('/api/events/999/registrations')).status, 404);
  const admissionPath = `/api/events/${eventId}/admission`;
  let admission = await (await request(admissionPath)).json(); assert.equal(admission.state, 'UNCONFIGURED');
  const confirmPath = `/api/registrations/${registration.id}/confirm`;
  assert.equal((await request(confirmPath, 'POST', { reviewed: true, event_version: admission.event_version })).status, 409);
  const capacityBody = { capacity: 1, event_version: admission.event_version };
  assert.equal((await request(admissionPath, 'PATCH', capacityBody, true, 'https://foreign.invalid')).status, 403);
  assert.equal((await request(admissionPath, 'PATCH', capacityBody)).status, 200);
  admission = await (await request(admissionPath)).json();
  assert.equal((await request(confirmPath, 'POST', { reviewed: false, event_version: admission.event_version })).status, 400);
  assert.equal((await request(confirmPath, 'POST', { reviewed: true, event_version: admission.event_version }, true, 'https://foreign.invalid')).status, 403);
  const confirmationBody = { reviewed: true, event_version: admission.event_version };
  const confirmResponse = await request(confirmPath, 'POST', confirmationBody); assert.equal(confirmResponse.status, 200);
  const confirmed = await confirmResponse.json(); assert.equal(confirmed.application_status, 'CONFIRMED'); assert.equal(confirmed.attendance_status, 'UNVERIFIED');
  assert.deepEqual(confirmed.snapshot, snapshot); assert(confirmed.confirmed_at); assert.equal(confirmed.confirmed_by, members[0].id);
  assert.deepEqual(await (await request(confirmPath, 'POST', confirmationBody)).json(), confirmed);
  const otherResponse = await request(registrationsPath, 'POST', { request_key: randomUUID(), snapshot: { name: '架空の満席確認', mobile: '000-3333-3333' } });
  assert.equal(otherResponse.status, 201); const other = await otherResponse.json();
  assert.equal((await request(`/api/registrations/${other.id}/confirm`, 'POST', confirmationBody)).status, 409);
  admission = await (await request(admissionPath)).json(); assert.equal(admission.confirmed_count, 1); assert.equal(admission.remaining, 0); assert.equal(admission.state, 'FULL');
  const confirmedDetail = await (await request(participantPath)).json();
  assert.equal(confirmedDetail.registrations.find((row: { id: number }) => row.id === registration.id).application_status, 'CONFIRMED');
  assert.equal((await request('/api/registrations/999/confirm', 'POST', confirmationBody)).status, 404);
  for (const path of ['/participants', `/participants/${registration.participant_id}`, `/events/${eventId}/registrations`]) {
    const response = await request(path); assert.equal(response.status, 200, path); assert.equal(response.headers.get('cache-control'), 'no-store');
    assert((await response.text()).includes('架空'));
  }
  for (const path of ['/events', '/events/new', `/events/${eventId}`, '/task-templates']) {
    const response = await request(path); assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert((await response.text()).includes('架空'));
  }
  assert((await (await request('/')).text()).includes('確認待ち'));
  assert.equal((await request('/api/auth/logout', 'POST')).status, 200);
  assert.equal((await request('/api/seminars')).status, 401);
  assert.equal((await request('/api/events')).status, 401);
  assert.equal((await request(participantPath)).status, 401);
  assert.equal((await request(registrationsPath)).status, 401);
  console.log('PASS: login/MFA/logout, unauthenticated page/API denial, CSRF denial, authenticated home, event/template/task management, cross-event registration/snapshot/contact history, manual seat confirmation/capacity limits and legacy seminar/participant CRUD. Synthetic isolated DB only.');
} finally {
  if (server.exitCode === null) {
    const stopped = once(server, 'exit');
    server.kill('SIGTERM');
    await stopped;
  }
  rmSync(directory, { recursive: true, force: true });
}
