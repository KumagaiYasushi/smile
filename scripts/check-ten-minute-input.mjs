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


for(const [name,viewport] of [['ten-minute-desktop',{width:1280,height:900}],['ten-minute-mobile',{width:390,height:844}]])await harness(name,viewport,async({page,password,step,layout,screenshot})=>{
  await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
  const date='2027-06-01';let id;
  async function valid(input,value,expected){const option=input.locator(`option[value="${value}"]`);if(!expected){if(await option.count())await expect(option).toHaveAttribute('disabled','');return;}await input.selectOption(value);assert.equal(await input.evaluate(el=>el.checkValidity()),true);}

  await step('ダイアルを表示せず開催・打ち合わせ・懇親会の時刻を10分単位で登録',async()=>{
    await page.goto(`${base}/seminars/new`);await page.getByLabel('セミナー名',{exact:false}).fill('10分単位の入力検証');await page.getByLabel('開催回数',{exact:false}).selectOption('SINGLE');await page.getByLabel('開催日 1',{exact:true}).fill(date);await page.getByLabel(`${date}の開催方法`).selectOption('ONSITE');
    await page.getByLabel(`${date}の時刻を設定`).check();
    await valid(page.getByLabel(`${date}の開始時刻`,{exact:true}),'09:35',false);await valid(page.getByLabel(`${date}の開始時刻`,{exact:true}),'09:30',true);
    await valid(page.getByLabel(`${date}の終了時刻`,{exact:true}),'09:20',false);await valid(page.getByLabel(`${date}の終了時刻`,{exact:true}),'10:30',true);
    await page.locator('[data-form-section="打ち合わせ"] > summary').click();await page.getByRole('button',{name:'＋ 打ち合わせを追加',exact:true}).click();
    const meeting=page.getByRole('group',{name:'打ち合わせ 1',exact:true});await meeting.getByLabel('打ち合わせ日',{exact:true}).fill('2027-05-20');
    await valid(meeting.getByLabel('開始時刻（任意・日本時間）',{exact:true}),'10:05',false);await valid(meeting.getByLabel('開始時刻（任意・日本時間）',{exact:true}),'10:10',true);
    await page.locator('[data-form-section="懇親会"] > summary').click();await page.getByLabel('懇親会の開催',{exact:true}).selectOption('HELD');
    await valid(page.getByLabel('懇親会の開始時刻',{exact:true}),'18:05',false);await valid(page.getByLabel('懇親会の開始時刻',{exact:true}),'18:10',true);
    await valid(page.getByLabel('懇親会の終了時刻',{exact:true}),'18:00',false);await valid(page.getByLabel('懇親会の終了時刻',{exact:true}),'19:00',true);
    await expect(page.getByRole('button',{name:/ダイアル/})).toHaveCount(0);await expect(page.locator('dialog')).toHaveCount(0);
    await layout('10分単位の時刻');await screenshot('time-input');await page.getByRole('button',{name:'登録する',exact:true}).click();await page.waitForURL(/\/seminars\/\d+$/);id=new URL(page.url()).pathname.split('/').pop();
    const event=await (await page.request.get(`${base}/api/seminars/${id}`)).json();assert.equal(event.event_times[date].start,'09:30');assert.equal(event.social_gathering.start_at,`${date}T18:10`);
    const meetings=await (await page.request.get(`${base}/api/seminars/${id}/meetings`)).json();assert.equal(meetings.meetings[0].time,'10:10');
  });
  await step('タイムスケジュール開始時刻を5分単位で入力し保存する',async()=>{
    await page.goto(`${base}/seminars/${id}/timetable`);const start=page.getByLabel('スケジュール開始時刻',{exact:true});await expect(start).toHaveValue('09:30');await expect(start).toHaveAttribute('data-minute-step','5');await valid(start,'09:35',true);await valid(start,'09:40',true);
    await page.getByLabel('項目を選択',{exact:true}).selectOption('BREAK');await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('status')).toContainText('保存しました');
    const endpoint=`${base}/api/seminars/${id}/timetable`,current=await (await page.request.get(endpoint)).json();assert.equal(current.days[0].start,'09:40');current.days[0].start='09:42';assert.equal((await page.request.put(endpoint,{headers:{Origin:base},data:{version:current.version,days:current.days}})).status(),400);
    await expect(page.getByRole('button',{name:/ダイアル/})).toHaveCount(0);await layout('タイムスケジュールの開始時刻');
  });
});
