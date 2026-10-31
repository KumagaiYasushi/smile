import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { developmentDirectory } from '../lib/development.ts';
import { totp } from '../lib/auth-store.ts';

process.env.SMILE_ENV = 'test';
process.env.SMILE_TEST_RUN = randomBytes(8).toString('hex');
const directory = developmentDirectory();
const reportDirectory = path.join(process.cwd(), 'data', 'reports', 'browser-verification', process.env.SMILE_TEST_RUN!);
mkdirSync(reportDirectory, { recursive: true });
const password = randomBytes(24).toString('hex');
const provision = spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/create-dev-admin.ts'], {
  env: { ...process.env, SMILE_DEV_EMAIL: 'browser@example.invalid', SMILE_DEV_NAME: '架空の確認管理者', SMILE_DEV_PASSWORD: password }, encoding: 'utf8',
});
assert.equal(provision.status, 0, 'isolated admin provisioning');
const base = 'http://127.0.0.1:3108';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3108'], { env: process.env, stdio: ['ignore', 'ignore', 'ignore'] });
let browser: Browser | undefined;
let page: Page;
const errors: string[] = [];
const checks: string[] = [];
async function check(name: string, run: () => Promise<void>) { await run(); checks.push(name); console.log(`PASS: ${name}`); }
async function saved(page: Page, action: () => Promise<void>, part: string, method: string) {
  const response = page.waitForResponse(response => response.url().includes(part) && response.request().method() === method);
  await action(); assert((await response).ok(), `save ${part}`);
}
async function screenshot(name: string) { await page.screenshot({ path: path.join(reportDirectory, name), fullPage: true }); }

try {
  browser = await chromium.launch({ ...(process.env.SMILE_CHROMIUM_PATH ? { executablePath: process.env.SMILE_CHROMIUM_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: 'Asia/Tokyo' });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => errors.push(error.message));
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Test server exited');
    try { if ((await fetch(base + '/login')).ok) { ready = true; break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert(ready);
  await check('未認証では管理画面に入れない', async () => {
    await page.goto(base + '/participants'); await page.waitForURL('**/login');
    await screenshot('01-login.png');
  });
  await check('パスワードと初回MFA登録でログイン', async () => {
    await page.getByLabel('メールアドレス', { exact: true }).fill('browser@example.invalid');
    await page.getByLabel('パスワード', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'ログイン', exact: true }).click();
    await page.getByRole('heading', { name: '管理者の本人確認' }).waitFor();
    const secret = await page.locator('code').innerText();
    await page.getByLabel('認証アプリの6桁コード').fill(totp(secret));
    await page.getByRole('button', { name: '確認してログイン' }).click();
    await page.getByRole('heading', { name: '企画運営ホーム' }).waitFor();
  });
  await check('標準タスクを画面から登録', async () => {
    await page.goto(base + '/task-templates');
    await page.locator('[name=title]').fill('架空の講師資料確認');
    await page.locator('[name=relative_days]').fill('-30');
    await page.locator('[name=important]').check();
    await saved(page, () => page.getByRole('button', { name: '保存', exact: true }).click(), '/api/task-templates', 'POST');
    await page.getByRole('button', { name: /架空の講師資料確認/ }).waitFor();
    await screenshot('02-templates.png');
  });
  let firstEventUrl = '';
  async function createEvent(title: string) {
    await page.goto(base + '/events/new');
    await page.locator('[name=title]').fill(title);
    await page.locator('[name=venue]').fill('架空の研修会場');
    await page.locator('[name=lecturer]').fill('架空の講師');
    await page.locator('[name=owner_id]').selectOption({ label: '架空の確認管理者' });
    await page.locator('[name=start-1]').fill('2028-03-01T10:00');
    await page.locator('[name=end-1]').fill('2028-03-01T17:00');
    await page.getByRole('button', { name: '＋ 開催回を追加' }).click();
    await page.locator('[name=start-2]').fill('2028-04-01T10:00');
    await page.locator('[name=end-2]').fill('2028-04-01T17:00');
    await page.getByRole('button', { name: 'イベントを作成してタスクを生成' }).click();
    await page.waitForURL(/\/events\/\d+$/);
    await page.getByRole('heading', { name: title, exact: true }).waitFor();
  }
  await check('複数開催回の作成と開催日からの期限生成', async () => {
    await createEvent('架空ベーシックコースA'); firstEventUrl = page.url();
    assert.equal(await page.locator('input[name=due_on]').first().inputValue(), '2028-01-31');
    assert((await page.locator('main').innerText()).includes('第2回'));
  });
  await check('タスクの担当・状態を保存して再表示', async () => {
    const task = page.locator('form[id^=task-]').first();
    await task.locator('[name=status]').selectOption('REVIEW');
    await task.locator('[name=assignee_id]').selectOption({ label: '架空の確認管理者' });
    await saved(page, () => task.getByRole('button', { name: 'タスクを保存' }).click(), '/api/tasks/', 'PATCH');
    await page.reload(); assert.equal(await task.locator('[name=status]').inputValue(), 'REVIEW');
    await screenshot('03-event-desktop.png');
  });
  await check('日程プレビュー後も保存済み日程と期限が変わらない', async () => {
    const original = await page.locator('input[name=due_on]').first().inputValue();
    await page.locator('[name=new_date]').fill('2028-03-11');
    await saved(page, () => page.getByRole('button', { name: '差分を確認' }).click(), '/schedule-preview', 'POST');
    await page.getByText('2028-01-31 → 2028-02-10', { exact: true }).waitFor();
    await page.reload(); assert.equal(await page.locator('input[name=due_on]').first().inputValue(), original);
    assert.equal(await page.locator('[name=new_date]').inputValue(), '2028-03-01');
  });
  async function register(name = '架空の受講希望者') {
    await page.getByRole('link', { name: '申込情報を管理', exact: true }).click();
    await page.locator('[name=name]').fill(name);
    await page.locator('[name=mobile]').fill('000-0000-0000');
    await page.locator('[name=email]').fill('participant@example.invalid');
    await page.locator('[name=workplace]').fill('架空の旧勤務先');
    await page.locator('form').filter({ has: page.locator('[name=name]') }).getByRole('checkbox').check();
    await saved(page, () => page.getByRole('button', { name: '申込情報を記録', exact: true }).click(), '/registrations', 'POST');
    await page.getByRole('status').waitFor();
  }
  let participantUrl = '';
  await check('申込を記録し、出欠未確認のまま表示', async () => {
    await register(); await page.getByText(/出欠未確認/).first().waitFor();
    await screenshot('04-registrations.png');
    await page.getByRole('link', { name: '参加者の履歴を確認' }).click();
    await page.waitForURL(/\/participants\/\d+$/);
    participantUrl = page.url();
  });
  await check('別イベントで氏名＋携帯が一致した参加者に紐付く', async () => {
    await createEvent('架空ベーシックコースB'); await register();
    await page.getByRole('status').filter({ hasText: '氏名・携帯の一意一致' }).waitFor();
    await page.getByRole('link', { name: '参加者の履歴を確認' }).click();
    await page.waitForURL(/\/participants\/\d+$/);
    await page.getByRole('heading', { name: 'イベント別の申込時情報' }).waitFor();
    assert.equal(page.url(), participantUrl);
    assert.equal(await page.getByRole('heading', { name: 'イベント別の申込時情報' }).locator('..').locator('article').count(), 2);
  });
  await check('代表情報の変更後も過去の申込時情報が残る', async () => {
    await page.locator('[name=workplace]').fill('架空の新勤務先');
    await page.getByRole('checkbox').check();
    await saved(page, () => page.getByRole('button', { name: '代表情報を保存', exact: true }).click(), '/api/participants/', 'PATCH');
    await page.reload(); assert.equal(await page.locator('[name=workplace]').inputValue(), '架空の新勤務先');
    const snapshots = page.getByRole('heading', { name: 'イベント別の申込時情報' }).locator('..');
    assert.equal(await snapshots.getByText('架空の旧勤務先', { exact: true }).count(), 2);
    await screenshot('05-participant-history.png');
  });
  await check('参加者検索が動き、検索語がURLに残らない', async () => {
    await page.goto(base + '/participants');
    await page.getByLabel('氏名・携帯・メール・勤務先').fill('新勤務先');
    await saved(page, () => page.getByRole('button', { name: '検索', exact: true }).click(), '/api/participants/search', 'POST');
    await page.getByRole('status').filter({ hasText: '1人' }).waitFor();
    assert.equal(new URL(page.url()).search, '');
  });
  await check('定員設定と明示確認で受付を確定し、出欠未確認を維持', async () => {
    await page.goto(firstEventUrl + '/registrations');
    const capacity = page.locator('form').filter({ has: page.locator('[name=capacity]') });
    await capacity.locator('[name=capacity]').fill('1'); await capacity.getByRole('checkbox').check();
    await saved(page, () => capacity.getByRole('button', { name: '定員を保存' }).click(), '/admission', 'PATCH');
    const card = page.locator('article').filter({ hasText: '架空の受講希望者' });
    await card.getByRole('checkbox').check();
    await saved(page, () => card.getByRole('button', { name: '受付を確定', exact: true }).click(), '/confirm', 'POST');
    await card.getByText('受付確定済み（出欠・入金とは別）').waitFor();
    assert((await card.innerText()).includes('出欠未確認'));
  });
  await check('満席では別の申込の確定ボタンを利用できない', async () => {
    await page.goto(firstEventUrl); await register('架空の満席確認者');
    const card = page.locator('article').filter({ hasText: '架空の満席確認者' });
    await card.waitFor(); assert(await card.getByRole('button', { name: '受付を確定', exact: true }).isDisabled());
    assert((await page.locator('main').innerText()).includes('残席：0'));
    await screenshot('08-admission-desktop.png');
  });
  await check('PCとスマートフォン幅で主要画面が横にはみ出さない', async () => {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 844 });
      for (const url of [base + '/', base + '/events/new', firstEventUrl, firstEventUrl + '/registrations', participantUrl, base + '/participants']) {
        await page.goto(url); await page.locator('h1').waitFor();
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `horizontal overflow at ${width}: ${new URL(url).pathname}`);
      }
    }
    await page.goto(firstEventUrl); await screenshot('06-event-mobile.png');
    await page.goto(base + '/'); await screenshot('07-home-mobile.png');
    await page.goto(firstEventUrl + '/registrations'); await screenshot('09-admission-mobile.png');
  });
  await check('ログアウト後は管理画面へ戻れない', async () => {
    await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
    await page.waitForURL('**/login'); await page.goto(participantUrl); await page.waitForURL('**/login');
  });
  assert.deepEqual(errors, [], 'browser runtime errors');
  writeFileSync(path.join(reportDirectory, 'result.json'), JSON.stringify({ completed_at: new Date().toISOString(), passed: checks, browser_runtime_errors: 0, synthetic_data_only: true }, null, 2));
  console.log(`Browser verification passed (${checks.length} scenarios). Report: ${reportDirectory}`);
} finally {
  await browser?.close();
  if (server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
  rmSync(directory, { recursive: true, force: true });
}
