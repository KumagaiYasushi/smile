import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';

const directory = mkdtempSync(join(tmpdir(), 'smile-verification-browser-'));
const base = 'http://localhost:3301', output = resolve('test-results/verification');
const password = randomBytes(24).toString('base64url');
const env = { ...process.env, SMILE_VERIFICATION_DATA_DIR: directory, PORT: '3301', SMILE_VERIFICATION_ORIGIN: base };
let server, browser, logs = '';
const errors = [];
try {
  execFileSync(process.execPath, ['scripts/verification.mjs', 'setup', 'verifier@example.invalid'], { env, input: JSON.stringify({ password }), stdio: 'pipe' });
  server = spawn(process.execPath, ['scripts/verification.mjs', 'start'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => { logs = (logs + chunk).slice(-2000); });
  server.stderr.on('data', chunk => { logs = (logs + chunk).slice(-2000); });
  for (let attempt = 0; attempt < 300 && !logs.includes('Ready in'); attempt++) {
    if (server.exitCode !== null) throw new Error('Verification server failed to start');
    await delay(100);
  }
  assert.ok(logs.includes('Ready in'), 'verification server readiness');
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? '/usr/bin/chromium', headless: true });
  mkdirSync(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await context.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/verification`);
  await expect(page.getByRole('heading', { name: 'ログイン', exact: true })).toBeVisible();
  assert.equal((await page.request.get(`${base}/api/seminars`)).status(), 401);
  await page.getByLabel('メールアドレス', { exact: true }).fill('verifier@example.invalid');
  await page.getByLabel('パスワード', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'ログイン', exact: true }).click();
  if(await page.getByRole('button',{name:'システムメニューを開く',exact:true}).isVisible())await page.getByRole('button',{name:'システムメニューを開く',exact:true}).click();
  await page.getByRole('link', { name: '検証ページ', exact: true }).click();
  await expect(page.getByRole('heading', { name: '操作検証ページ', exact: true })).toBeVisible();
  const samples = page.getByRole('region', { name: '検証用サンプル', exact: true });
  await expect(samples.getByRole('article')).toHaveCount(3);
  await page.screenshot({ path: join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: join(output, 'mobile.png'), fullPage: true });
  for (const name of ['【検証】ベーシックコース', '【検証】講演会', '【検証】セミナー']) {
    const card = samples.getByRole('article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await card.getByRole('link', { name: '昼食の手配', exact: true }).click();
    await expect(page.getByRole('heading', { name: '昼食の手配', exact: true })).toBeVisible();
    const external = page.getByRole('article').filter({ has: page.getByRole('heading', { name: '外部講師の昼食', exact: true }) });
    await external.getByRole('button', { name: '編集', exact: true }).click();
    const editor = page.getByRole('form', { name: '昼食の手配編集', exact: true });
    await editor.getByLabel('外部講師のオーダー個数', { exact: true }).fill('2');
    await editor.getByRole('button', { name: '保存する', exact: true }).click();
    await expect(editor).toBeHidden({timeout:30000});
    await expect(external).toContainText('¥2,400');
    if(await page.getByRole('button',{name:'システムメニューを開く',exact:true}).isVisible())await page.getByRole('button',{name:'システムメニューを開く',exact:true}).click();
  await page.getByRole('link', { name: '検証ページ', exact: true }).click();
  }
  assert.deepEqual(errors, []);
  if(await page.getByRole('button',{name:'システムメニューを開く',exact:true}).isVisible())await page.getByRole('button',{name:'システムメニューを開く',exact:true}).click();
  await page.getByRole('button', { name: 'ログアウト', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ログイン', exact: true })).toBeVisible();
  await page.goto(`${base}/verification`);
  await expect(page.getByRole('heading', { name: 'ログイン', exact: true })).toBeVisible();
  console.log('PASS: isolated setup/start, protected verification page, three seeded events, desktop/mobile layout, external lecturer editing and logout');
} catch (error) {
  // Never emit the password, server logs, cookies or MFA key.
  const message = (error instanceof Error ? error.message : '検証ページの操作確認に失敗しました').replaceAll(password, '[redacted]');
  console.error(`FAIL: ${message}`); process.exitCode = 1;
} finally {
  await browser?.close();
  if (server && server.exitCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
  rmSync(directory, { recursive: true, force: true });
}
