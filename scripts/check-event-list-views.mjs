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


for(const [name,viewport] of [['event-views-desktop',{width:1280,height:900}],['event-views-mobile',{width:390,height:844}],['event-views-narrow',{width:320,height:700}]])await harness(name,viewport,async({page,password,step,layout,screenshot})=>{
 await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
 const origin={Origin:base};const response=await page.request.post(`${base}/api/seminars`,{headers:origin,data:{name:'架空：複数回コース',event_type:'BASIC_COURSE',occurrence_type:'MULTIPLE',dates:['2027-06-10','2027-06-20'],venue:'架空イベント会場',social_gathering:{status:'HELD',start_at:null,end_at:null,venue:'',fee:null,timings:['BEFORE','ON_DAY'],gatherings:[{id:'first',timing:'BEFORE',start_at:'2027-06-09T19:00',end_at:'2027-06-09T21:00',venue:'https://example.invalid/restaurant/first',fee:3000,budget:null,participants:null},{id:'second',timing:'ON_DAY',start_at:null,end_at:null,start_date:'2027-06-20',venue:'架空店B',fee:null,budget:null,participants:null}]}}});assert.equal(response.status(),201);const event=await response.json();
 assert.equal((await page.request.post(`${base}/api/seminars/${event.id}/meetings`,{headers:origin,data:{changes:[{action:'create',data:{title:'架空：準備ミーティング',date:'2027-05-01',time:'20:00',end_time:'22:00',method:'ONLINE',attendees:[]}}]}})).status(),200);
 assert.equal((await page.request.post(`${base}/api/seminars`,{headers:origin,data:{name:'架空：日程未定講演会',event_type:'LECTURE',occurrence_type:'SINGLE',dates:[],venue:'未定会場'}})).status(),201);
 await step('イベント・会議・懇親会を独立カードとして表示し日付順にする',async()=>{
  await page.goto(base+'/');await expect(page.locator('[data-entry-kind]')).toHaveCount(6);await expect(page.locator('[data-entry-kind="EVENT"]')).toHaveCount(3);await expect(page.locator('[data-entry-kind="MEETING"]')).toHaveCount(1);await expect(page.locator('[data-entry-kind="SOCIAL"]')).toHaveCount(2);await expect(page.locator('[data-entry-kind]').first()).toContainText('準備ミーティング');await expect(page.getByRole('button',{name:'詳細カード表示',exact:true})).toHaveAttribute('aria-pressed','true');await layout('詳細カード');await screenshot('cards');
 });
 await step('HOMEを新規登録・一覧・設定の順で表示し設定への移動を確認',async()=>{
  await page.goto(base+'/home');const content=page.locator('.app-workspace-content');await expect(content.getByRole('heading',{name:'HOME',exact:true})).toBeVisible();await expect(content.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();await expect(content.locator('[data-entry-kind]')).toHaveCount(6);const add=content.getByRole('link',{name:'新規イベント登録',exact:true});await expect(add).toHaveAttribute('href','/seminars/new');const settings=content.getByRole('link',{name:'システム設定',exact:true});await expect(settings).toHaveAttribute('href','/settings');const a=await add.boundingBox(),h=await content.getByRole('heading',{name:'イベント一覧',exact:true}).boundingBox(),b=await settings.boundingBox();assert(a.y<h.y&&h.y<b.y);await expect(page.getByRole('region',{name:'歯周基本治療研究会カレンダー',exact:true})).toHaveCount(0);await layout('HOMEの3要素');await screenshot('home-layout');await settings.click();await expect(content.getByRole('heading',{name:'システム設定',exact:true})).toBeVisible();await expect(content.getByRole('link',{name:'メール・カレンダー自動化設定',exact:true})).toHaveAttribute('href','/settings/automation');await expect(content.locator('a[href="/admin/users"]')).toHaveCount(0);await layout('システム設定');await screenshot('settings');await page.goto(base+'/');
 });
 await step('アイコンで3列の行表示へ切り替え保存し、会場URLと予定へのリンクを確認',async()=>{
  await page.getByRole('button',{name:'シンプルな行表示',exact:true}).click();const table=page.getByRole('table',{name:'予定の行一覧',exact:true});await expect(table.getByRole('columnheader')).toHaveText(['日付','イベント名','会場']);await expect(table.locator('tbody tr')).toHaveCount(6);await expect(table.locator('tbody tr').first()).toContainText('20:00〜22:00');await expect(table.locator('tbody tr').first()).toContainText('オンライン');await expect(table.locator('tbody tr').last()).toContainText('日程未定');await expect(table.getByRole('link',{name:'https://example.invalid/restaurant/first',exact:true})).toHaveAttribute('href','https://example.invalid/restaurant/first');await page.reload();await expect(page.getByRole('button',{name:'シンプルな行表示',exact:true})).toHaveAttribute('aria-pressed','true');await expect(table).toBeVisible();await layout('シンプルな行');await screenshot('rows');
  await table.getByRole('link',{name:'架空：準備ミーティング',exact:true}).click();await expect(page.getByRole('heading',{name:'打ち合わせ',exact:true})).toBeVisible();await page.goto(base+'/');await expect(table).toBeVisible();
 });
 await step('種別と予定の種類で絞り込み、失敗時と未認証の扱いを確認',async()=>{
  const table=page.getByRole('table',{name:'予定の行一覧',exact:true});await page.getByLabel('予定の種類',{exact:true}).selectOption('MEETING');await expect(table.locator('tbody tr')).toHaveCount(1);await page.getByLabel('イベント種別で絞り込み',{exact:true}).selectOption('LECTURE');await expect(page.getByText('条件に一致する予定はありません',{exact:true})).toBeVisible();await page.getByLabel('予定の種類',{exact:true}).selectOption('ALL');await expect(table.locator('tbody tr')).toHaveCount(1);await page.getByLabel('イベント種別で絞り込み',{exact:true}).selectOption('ALL');await expect(table.locator('tbody tr')).toHaveCount(6);
  await page.getByRole('button',{name:'詳細カード表示',exact:true}).click();await expect(page.locator('a[data-entry-kind]')).toHaveCount(6);
  const anon=await page.context().browser().newContext();try{assert.equal((await anon.request.get(`${base}/api/event-list`)).status(),401);}finally{await anon.close();}
  const api=await page.request.get(`${base}/api/event-list`);assert.equal(api.status(),200);assert.equal(api.headers()['cache-control'],'no-store');assert.equal((await api.json()).entries.length,6);
  await page.route('**/api/event-list',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'架空：取得エラー'})}));await page.reload();await expect(page.getByRole('alert').filter({hasText:'架空：取得エラー'})).toBeVisible();await expect(page.getByText('セミナーを登録しましょう',{exact:true})).toHaveCount(0);await layout('取得失敗');
 });
});
