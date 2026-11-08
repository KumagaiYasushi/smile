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


for(const [name,viewport] of [['automation-desktop',{width:1280,height:900}],['automation-mobile',{width:390,height:844}]])await harness(name,viewport,async({page,password,step,layout,screenshot})=>{
 await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();const origin={Origin:base},events=[];
 for(const [event_type,name] of [['LECTURE','架空：講演会'],['BASIC_COURSE','架空：基礎コース']]){const r=await page.request.post(`${base}/api/seminars`,{headers:origin,data:{event_type,name,occurrence_type:'SINGLE',dates:[]}});assert.equal(r.status(),201);events.push(await r.json());}
 const content=page.locator('.app-workspace-content'),mail=page.getByRole('region',{name:'メール接続の設定',exact:true}),calendar=page.getByRole('region',{name:'カレンダー接続の設定',exact:true}),participant=page.getByRole('region',{name:'イベントごとの自動メール設定',exact:true});
 await step('システム設定から一画面でGmail・カレンダー・自動メールへ進む',async()=>{
  await page.goto(base+'/settings');await content.getByRole('link',{name:'メール・カレンダー自動化設定',exact:true}).click();await expect(content.getByRole('heading',{name:'メール・カレンダー自動化設定',exact:true})).toBeVisible();await expect(mail.getByRole('heading',{name:'Gmail連携',exact:true})).toBeVisible();await expect(calendar.getByRole('heading',{name:'Googleカレンダー連携',exact:true})).toBeVisible();await expect(calendar.getByText('接続・解除は管理者が行います。',{exact:true})).toBeVisible();await expect(mail.getByRole('button',{name:'GoogleでGmailを接続',exact:true})).toBeDisabled();await layout('自動化の設定');await screenshot('connections');
 });
 await step('イベント別設定を保存し切り替え時の未保存破棄を確認',async()=>{
  const selector=participant.getByLabel('設定するイベント',{exact:true});await selector.selectOption(String(events[0].id));await participant.getByText('自動メール・Googleフォーム連携の設定',{exact:true}).click();await expect(participant.getByLabel('事前課題',{exact:true})).toHaveCount(0);const url=participant.getByLabel('臨床相談フォームURL',{exact:true});await url.fill('https://example.invalid/clinical');page.once('dialog',d=>d.dismiss());await selector.selectOption(String(events[1].id));await expect(selector).toHaveValue(String(events[0].id));await expect(url).toHaveValue('https://example.invalid/clinical');await participant.getByRole('button',{name:'自動メール設定を保存',exact:true}).click();await expect(participant.getByRole('status')).toContainText('保存しました');
  await selector.selectOption(String(events[1].id));await participant.getByText('自動メール・Googleフォーム連携の設定',{exact:true}).click();await expect(participant.getByLabel('事前課題',{exact:true})).toBeVisible();await expect(participant.getByLabel('臨床相談フォームURL',{exact:true})).toHaveValue('');await participant.getByLabel('事前課題',{exact:true}).fill('架空：症例を準備');page.once('dialog',d=>d.accept());await selector.selectOption(String(events[0].id));await participant.getByText('自動メール・Googleフォーム連携の設定',{exact:true}).click();await expect(participant.getByLabel('臨床相談フォームURL',{exact:true})).toHaveValue('https://example.invalid/clinical');await layout('イベントの自動メール設定');await screenshot('event-mail');
 });
 await step('Google認証の戻り先を固定し旧画面と権限を維持',async()=>{
  const cal=await page.request.get(`${base}/api/calendar/callback?error=access_denied`,{headers:{Cookie:'smile_calendar_return=automation'},maxRedirects:0});assert.equal(new URL(cal.headers().location).pathname,'/settings/automation');assert.equal(new URL(cal.headers().location).hash,'#calendar');
  const bad=await page.request.get(`${base}/api/calendar/callback?error=access_denied`,{headers:{Cookie:'smile_calendar_return=https://elsewhere.invalid'},maxRedirects:0});assert.equal(new URL(bad.headers().location).pathname,'/calendar');
  const gmail=await page.request.get(`${base}/api/gmail/callback?error=access_denied`,{headers:{Cookie:'smile_gmail_return=automation'}});assert.equal(gmail.status(),400);assert.match(await gmail.text(),/href="\/settings\/automation#gmail"/);assert.equal((await page.request.post(`${base}/api/calendar/connect?return=automation`,{headers:origin})).status(),403);
  await page.goto(base+'/gmail');await expect(page.getByRole('heading',{name:'Gmail連携',exact:true})).toBeVisible();await page.goto(base+'/calendar');await expect(page.getByRole('heading',{name:'Googleカレンダー連携',exact:true})).toBeVisible();await layout('従来のカレンダー接続');
 });
});
