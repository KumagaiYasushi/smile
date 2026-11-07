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


for(const [name,viewport] of [['calendar-decision-desktop',{width:1280,height:900}],['calendar-decision-mobile',{width:390,height:844}]])await harness(name,viewport,async({page,password,step,layout,screenshot})=>{
 await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
 const eventResponse=await page.request.post(`${base}/api/seminars`,{headers:{Origin:base},data:{name:'架空：カレンダーと日程決定',event_type:'SEMINAR',occurrence_type:'SINGLE',dates:['2027-06-01'],event_times:{'2027-06-01':{start:'10:00',end:'17:00'}}}});assert.equal(eventResponse.status(),201);const event=await eventResponse.json(),url=`${base}/api/seminars/${event.id}/meeting-poll`;
 const result=await page.request.put(url,{headers:{Origin:base},data:{title:'候補から確定する会議',version:0,candidates:[{date:'2027-05-01',start:'20:00',end:'22:00'},{date:'2027-05-02',start:'20:00',end:'22:00'}]}});assert.equal(result.status(),200);const initial=await result.json();
 await page.goto(`${base}/seminars/${event.id}/meetings`);const poll=page.getByRole('region',{name:'打ち合わせの日程調整',exact:true});
 await step('候補から開催方法を確認して決定し開始・終了を確定会議に反映',async()=>{
  await poll.getByRole('columnheader').filter({hasText:'5/1'}).getByRole('button',{name:'この日に決定',exact:true}).click();const dialog=page.getByRole('dialog',{name:'打ち合わせ日時を決定',exact:true});await expect(dialog).toBeVisible();await expect(dialog).toContainText('20:00〜22:00');await dialog.getByLabel('確定する打ち合わせの開催方法',{exact:true}).selectOption('ONSITE');await dialog.getByRole('button',{name:'この日時で確定して登録',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(poll.getByRole('status')).toContainText('打ち合わせの日程を決定');await expect(page.getByLabel('打ち合わせ名',{exact:true})).toHaveValue('候補から確定する会議');await expect(page.getByLabel('打ち合わせの終了時刻',{exact:true})).toHaveValue('22:00');await expect(poll.getByRole('columnheader').filter({hasText:'5/1'}).getByRole('button',{name:'この日に決定',exact:true})).toBeEnabled();await layout('日程決定');await screenshot('decided');
 });
 await step('別候補への決定変更で同じ会議を更新し同時・再送でも重複しない',async()=>{
  const before=await(await page.request.get(`${base}/api/seminars/${event.id}/meetings`)).json();assert.equal(before.meetings.length,1);const meetingId=before.meetings[0].id;
  await poll.getByRole('columnheader').filter({hasText:'5/1'}).getByRole('button',{name:'この日に決定',exact:true}).click();await expect(page.getByRole('dialog').getByLabel('確定する打ち合わせの開催方法',{exact:true})).toHaveValue('ONSITE');await page.getByRole('dialog').getByLabel('決定する候補日時',{exact:true}).selectOption(String(initial.candidates[1].id));await expect(page.getByRole('dialog')).toContainText('2027-05-02');await page.getByRole('dialog').getByRole('button',{name:'この日時で確定して登録',exact:true}).click();await expect(page.getByLabel('打ち合わせ日',{exact:true})).toHaveValue('2027-05-02');
  const again=await Promise.all([1,2].map(()=>page.request.post(url,{headers:{Origin:base},data:{candidate_id:initial.candidates[1].id,revision:initial.candidates[1].revision,version:initial.version,title:initial.title,method:'ONLINE'}})));assert(again.every(r=>r.status()===200));const after=await(await page.request.get(`${base}/api/seminars/${event.id}/meetings`)).json();assert.equal(after.meetings.length,1);assert.equal(after.meetings[0].id,meetingId);assert.equal(after.meetings[0].method,'ONSITE');await page.reload();await expect(poll.getByRole('columnheader').filter({hasText:'5/2'})).toContainText('✓ 決定済み');await expect(poll.getByRole('columnheader').filter({hasText:'5/2'}).getByRole('button',{name:'この日に決定',exact:true})).toBeEnabled();
  assert.equal((await page.request.post(url,{headers:{Origin:base},data:{candidate_id:initial.candidates[0].id,revision:99,version:initial.version,title:initial.title,method:'ONLINE'}})).status(),409);
 });
 await step('未接続の予定を保持し設定画面と認証を確認',async()=>{
  await page.goto(`${base}/calendar`);await expect(page.getByRole('heading',{name:'Googleカレンダー連携',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'未接続',exact:true})).toBeVisible();await expect(page.getByText('接続・解除は管理者が行います。',{exact:true})).toBeVisible();assert.equal((await page.request.post(`${base}/api/calendar/connect`,{headers:{Origin:base}})).status(),403);assert.equal((await page.request.delete(`${base}/api/calendar`,{headers:{Origin:base}})).status(),403);
  const status=await(await page.request.get(`${base}/api/calendar`)).json();assert.equal(status.connected,false);assert.equal(status.configured,false);assert(status.pending+status.dirty>=2);assert(!JSON.stringify(status).includes('token_cipher'));
  assert.equal((await page.request.post(`${base}/api/calendar`,{headers:{Origin:'https://other.invalid'},data:{all:true}})).status(),403);
  const anon=await page.context().browser().newContext();try{assert.equal((await anon.request.get(`${base}/api/calendar`)).status(),401);}finally{await anon.close();}
  await layout('カレンダーの設定');await screenshot('calendar-settings');
 });
});
