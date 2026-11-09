import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { createAuthStore } from '../lib/auth.ts';

// Synthetic credentials live only in memory and in a temporary database.
// No traces/HAR files are recorded: they could contain passwords or MFA enrollment keys.
const secrets = new Set();
const remember = (value) => { secrets.add(value); return value; };
function sanitized(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const value of secrets) message = message.replaceAll(value, '[redacted]');
  return new Error(message);
}
const base = 'http://localhost:3200';
const output = resolve('test-results/browser');
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium';
assert.ok(existsSync('.next/BUILD_ID'), 'Run npm run build before browser checks');
assert.ok(existsSync(executablePath), 'A Chromium executable is required');
mkdirSync(output, { recursive: true });

async function harness(name, viewport, run) {
  const directory = mkdtempSync(join(tmpdir(), 'smile-browser-'));
  const key = remember(randomBytes(32).toString('hex'));
  const password = remember(randomBytes(24).toString('base64url'));
  const artifactDirectory = join(output, name);
  mkdirSync(artifactDirectory, { recursive: true });
  let db, server, browser, page;
  let logs = '';
  const errors = [];
  const stages = [];
  try {
    db = new Database(join(directory, 'seminars.db'));
    const auth = createAuthStore(db, key);
    await auth.createUser('member@example.invalid', password, 'member');
    await auth.createUser('admin@example.invalid', password, 'admin');
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3200'], {
      cwd: process.cwd(), env: { ...process.env, SMILE_DATA_DIR: directory, AUTH_MFA_KEY: key, APP_ORIGIN: base }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    server.stdout.on('data', (chunk) => { logs = (logs + chunk).slice(-4000); });
    server.stderr.on('data', (chunk) => { logs = (logs + chunk).slice(-4000); });
    for (let attempt = 0; attempt < 100 && !logs.includes('Ready in'); attempt++) {
      if (server.exitCode !== null) throw new Error('Isolated browser test server failed to start');
      await delay(100);
    }
    assert.ok(logs.includes('Ready in'), 'isolated server readiness');
    browser = await chromium.launch({ executablePath, headless: true });
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, hasTouch: viewport.width < 600, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    await context.route('**/*', (route) => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    context.on('page', (opened) => opened.on('pageerror', (error) => errors.push(error.message)));
    page = await context.newPage();
    page.setDefaultTimeout(7000);
    async function screenshot(label, target = page) {
      if (new URL(target.url()).pathname.startsWith('/login')) return;
      await target.screenshot({ path: join(artifactDirectory, `${label}.png`), fullPage: true });
    }
    async function layout(label, target = page) {
      const size = await target.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
      assert.ok(size.content <= size.width + 1, `${label}: page horizontally overflows (${size.content} > ${size.width})`);
    }
    async function step(label, action) {
      await action(); stages.push(label); console.log(`PASS ${name}: ${label}`);
    }
    await run({ page, context, db, password, step, screenshot, layout });
    assert.deepEqual(errors, [], 'uncaught browser errors');
    rmSync(join(artifactDirectory, 'failure.png'), { force: true });
    writeFileSync(join(artifactDirectory, 'result.json'), JSON.stringify({ scenario: name, viewport, stages, browser_errors: errors }, null, 2));
  } catch (error) {
    if (page && !page.isClosed() && page.url().startsWith(base) && !new URL(page.url()).pathname.startsWith('/login')) {
      await page.screenshot({ path: join(artifactDirectory, 'failure.png'), fullPage: true }).catch(() => {});
    }
    writeFileSync(join(artifactDirectory, 'result.json'), JSON.stringify({ scenario: name, viewport, stages, failure: sanitized(error).message }, null, 2));
    throw sanitized(error);
  } finally {
    await browser?.close();
    if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}

async function login(page, password, email = 'member@example.invalid') {
  await page.goto(`${base}/`);
  await expect(page.getByRole('heading', { name: 'ログイン', exact: true })).toBeVisible();
  await page.getByLabel('メールアドレス', { exact: true }).fill(email);
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
}

for (const [name, viewport] of [['member-page-desktop', { width: 1280, height: 900 }], ['member-page-mobile', { width: 390, height: 844 }], ['member-page-narrow', { width: 320, height: 700 }]]) await harness(name, viewport, async ({ page, password, db, step, layout, screenshot }) => {
  const origin = { Origin: base };
  assert.equal((await page.request.get(base + '/api/member-page')).status(), 401);
  await login(page, password); await expect(page.getByRole('heading', { name: 'イベント一覧', exact: true })).toBeVisible();
  const directory = await (await page.request.get(base + '/api/society-members')).json();
  const a = directory.members.find(p => p.role === 'SOCIETY_LECTURER'), b = directory.members.find(p => p.role === 'SOCIETY_SUPPORT');
  const p = member => ({ member_id: member.id ?? member.member_id, member_version: member.version ?? member.member_version });
  const response = await page.request.post(base + '/api/seminars', { headers: origin, data: { name: '架空：個人ページ確認', event_type: 'SEMINAR', occurrence_type: 'MULTIPLE', dates: ['2099-06-01', '2099-06-08'], venue: '架空会場', speakers: [{ role: a.role, id: a.id, name: a.name, facility: '', theme: '架空テーマ', date: '2099-06-01' }] } });
  assert.equal(response.status(), 201); const event = await response.json();
  const eventPath = base + `/api/seminars/${event.id}`;
  const initial = await (await page.request.get(eventPath + '/roles')).json();
  const days = () => ({ RECEPTION: [], MC: [], CHAIR: [], SOCIAL: [] });
  const roles = { version: initial.version, assignments: { ...initial.assignments, VENUE: [p(a), p(b)] }, day_assignments: { '2099-06-01': { ...days(), CHAIR: [p(a)] }, '2099-06-08': { ...days(), CHAIR: [p(b)] } } };
  assert.equal((await page.request.put(eventPath + '/roles', { headers: origin, data: roles })).status(), 200);
  const createTask = async (title, due_date = null) => {
    const response = await page.request.post(eventPath + '/tasks', { headers: origin, data: { title, due_date } });
    assert.equal(response.status(), 201); return (await response.json()).task;
  };
  const chair = await createTask('架空：初日の座長確認'), venue = await createTask('架空：会場の確認', '2020-01-01');
  await createTask('架空：未連動のタスク');
  assert.equal((await page.request.put(eventPath + `/tasks/${venue.id}/role-link`, { headers: origin, data: { role: 'VENUE', date: null, version: 0 } })).status(), 200);
  await step('運営のタスク画面で役割と開催日の連動を設定する', async () => {
    await page.goto(base + `/seminars/${event.id}/tasks`);
    const article = page.getByRole('article').filter({ has: page.getByRole('heading', { name: chair.title, exact: true }) });
    await article.locator('summary').filter({ hasText: '役割と連動するタスクに設定' }).click();
    await article.getByLabel('連動する役割', { exact: true }).selectOption('CHAIR');
    await article.getByLabel('対象の開催日', { exact: true }).selectOption('2099-06-01');
    await article.getByRole('button', { name: '連動設定を保存', exact: true }).click();
    await expect(article.getByRole('status')).toHaveText('役割との連動を保存しました');
    const saved = await (await page.request.get(eventPath + `/tasks/${chair.id}/role-link`)).json(); assert.equal(saved.link.role, 'CHAIR'); assert.equal(saved.link.date, '2099-06-01');
    await layout('役割連動の入力');
  });
  const card = () => page.locator(`[data-member-event="${event.id}"]`);
  await step('個別アカウントなしで名前を選び出欠・当日役割・期限アラートをまとめて表示する', async () => {
    await page.goto(base + '/my-page');
    await page.getByLabel('自分の名前', { exact: true }).selectOption(String(a.id));
    await expect(page.getByRole('heading', { name: `${a.name}さんの予定・担当`, exact: true })).toBeVisible();
    await expect(card()).toContainText('2099-06-01：座長'); await expect(card()).not.toContainText('2099-06-08：座長');
    await expect(card()).toContainText('期限超過');
    await card().locator('summary').filter({ hasText: '担当タスク・進捗' }).click();
    await expect(card().locator('[data-member-task]')).toHaveCount(2); await expect(card()).not.toContainText('架空：未連動のタスク');
    await layout('個人ページの担当一覧'); await screenshot('member-tasks');
    assert.equal(db.prepare('SELECT count(*) n FROM auth_users').get().n, 2);
    await page.reload(); await expect(page.getByLabel('自分の名前', { exact: true })).toHaveValue(String(a.id));
  });
  await step('演者の欠席に確認を表示し、キャンセル時には保存しない。確定時はイベント出欠と共有する', async () => {
    await card().locator('summary').filter({ hasText: '出欠を確認・登録' }).click();
    const choice = card().getByLabel(`${event.name} 2099-06-01の出欠`, { exact: true });
    page.once('dialog', dialog => dialog.dismiss()); await choice.selectOption('ABSENT'); await expect(choice).toHaveValue('UNANSWERED');
    page.once('dialog', dialog => { assert.ok(dialog.message().includes('演者')); return dialog.accept(); });
    await choice.selectOption('ABSENT'); await expect(page.getByRole('status')).toHaveText('出欠を保存しました'); await expect(choice).toHaveValue('ABSENT');
    await expect(card()).toContainText('欠席ですが座長');
    await card().getByLabel(`${event.name} 2099-06-08の出欠`, { exact: true }).selectOption('ATTENDING');
    await expect(page.getByRole('status')).toHaveText('出欠を保存しました');
    const roster = await (await page.request.get(eventPath + '/staff-attendance')).json();
    const staff = roster.people.find(item => item.name === a.name && item.role === a.role);
    assert.equal(staff.responses['2099-06-01'], 'ABSENT'); assert.equal(staff.responses['2099-06-08'], 'ATTENDING');
    await layout('出欠の保存'); await screenshot('member-attendance');
  });
  await step('役割に連動した進捗を編集し、複数担当者と共有する', async () => {
    await card().locator('summary').filter({ hasText: '担当タスク・進捗' }).click();
    await card().getByLabel(`${event.name} ${venue.title}の進捗`, { exact: true }).selectOption('DONE');
    await expect(page.getByRole('status')).toHaveText('タスク進捗を保存しました');
    const task = await (await page.request.get(eventPath + `/tasks/${venue.id}`)).json(); assert.equal(task.task.status, 'DONE'); assert.equal(task.task.due_date, '2020-01-01');
    await page.getByLabel('自分の名前', { exact: true }).selectOption(String(b.id));
    await expect(page.getByRole('heading', { name: `${b.name}さんの予定・担当`, exact: true })).toBeVisible();
    await expect(card()).toContainText('2099-06-08：座長'); await expect(card()).not.toContainText('2099-06-01：座長');
    await card().locator('summary').filter({ hasText: '担当タスク・進捗' }).click();
    await expect(card().locator('[data-member-task]')).toHaveCount(1);
    await expect(card().getByLabel(`${event.name} ${venue.title}の進捗`, { exact: true })).toHaveValue('DONE');
    await card().locator('summary').filter({ hasText: '出欠を確認・登録' }).click();
    await expect(card().getByLabel(`${event.name} 2099-06-01の出欠`, { exact: true })).toHaveValue('UNANSWERED');
    await layout('別のメンバーへの切り替え');
  });
  await step('競合・送信元・変更禁止項目を検証し、古い表示からの上書きを防止する', async () => {
    let data = await (await page.request.get(base + `/api/member-page?member_id=${b.id}`)).json();
    const current = data.events.find(e => e.id === event.id), task = current.tasks[0];
    const payload = { action: 'task', event_id: event.id, task_id: task.id, data: { status: 'IN_PROGRESS', version: task.version, link_version: task.role_link.version, role_version: current.role_version } };
    assert.equal((await page.request.post(base + `/api/member-page/${b.id}`, { data: payload })).status(), 403);
    assert.equal((await page.request.post(base + `/api/member-page/${b.id}`, { headers: origin, data: { ...payload, data: { ...payload.data, assignee_id: 1 } } })).status(), 400);
    const roleData = await (await page.request.get(eventPath + '/roles')).json();
    const updated = { version: roleData.version, assignments: Object.fromEntries(Object.entries(roleData.assignments).map(([key, people]) => [key, people.map(p)])), day_assignments: Object.fromEntries(Object.entries(roleData.day_assignments).map(([date, day]) => [date, Object.fromEntries(Object.entries(day).map(([key, people]) => [key, people.map(p)]))])) };
    updated.assignments.VENUE = [p(a)]; updated.day_assignments['2099-06-01'].CHAIR = [];
    assert.equal((await page.request.put(eventPath + '/roles', { headers: origin, data: updated })).status(), 200);
    await card().getByLabel(`${event.name} ${venue.title}の進捗`, { exact: true }).selectOption('IN_PROGRESS');
    await expect(page.locator('[data-member-editor]').getByRole('alert')).toContainText('役割またはタスク連動が変更されています');
    assert.equal((await (await page.request.get(eventPath + `/tasks/${venue.id}`)).json()).task.status, 'DONE');
    await page.getByRole('button', { name: '最新情報を取得', exact: true }).click();
    await expect(card().locator('[data-member-task]')).toHaveCount(0); await expect(page.locator('[data-member-editor]').getByRole('alert')).toHaveCount(0);
    await page.getByLabel('対応が必要なイベントだけ', { exact: true }).check(); await expect(card()).toBeVisible();
    await layout('競合からの再取得'); await screenshot('member-after-refresh');
  });
});
