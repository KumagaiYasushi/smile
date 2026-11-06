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


for(const [name,viewport] of [['event-list-desktop',{width:1280,height:900}],['event-list-mobile',{width:390,height:844}]])await harness(name,viewport,async({page,password,step,layout,screenshot})=>{
  await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
  const create=page.getByRole('link',{name:'新規イベントを作成',exact:true});
  await step('空の一覧でも目立つ新規作成から登録画面を開く',async()=>{
    await expect(create).toBeVisible();assert.ok((await create.boundingBox()).height>=52);await create.click();await expect(page.getByRole('heading',{name:'新規セミナー登録',exact:true})).toBeVisible();
  });
  for(const input of [{name:'歯周基本治療セミナー',event_type:'SEMINAR',occurrence_type:'SINGLE',dates:['2027-06-15'],event_times:{'2027-06-15':{start:'10:00',end:'17:00'}},venue:'研究会研修センター 2階 第1研修室',lecturer_name:'研究会講師'},{name:'症例検討会と実践講座',event_type:'LECTURE',occurrence_type:'MULTIPLE',dates:['2027-07-01','2027-07-08'],venue:'市民交流センター 会議室A'}]){
    const response=await page.request.post(`${base}/api/seminars`,{headers:{Origin:base},data:{...input,delivery_method:'ONSITE'}});assert.equal(response.status(),201);
  }
  await page.goto(base);
  await step('カードを背景から区別し白文字の見出しを読みやすく表示',async()=>{
    const heading=page.getByRole('heading',{name:'歯周基本治療セミナー',exact:true}),card=page.getByRole('link').filter({has:heading});await expect(card).toBeVisible();
    const colors=await card.evaluate(el=>({card:getComputedStyle(el).backgroundColor,list:getComputedStyle(el.parentElement).backgroundColor,border:parseFloat(getComputedStyle(el).borderTopWidth)}));assert.notEqual(colors.card,colors.list);assert.ok(colors.border>=2);
    const contrast=await heading.evaluate(el=>{const header=el.parentElement.parentElement,canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');function luminance(color){ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const rgb=ctx.getImageData(0,0,1,1).data;const v=[...rgb].slice(0,3).map(n=>{const c=n/255;return c<=0.04045?c/12.92:((c+0.055)/1.055)**2.4;});return v[0]*0.2126+v[1]*0.7152+v[2]*0.0722;}const a=luminance(getComputedStyle(el).color),b=luminance(getComputedStyle(header).backgroundColor);return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);});assert.ok(contrast>=4.5,'見出し文字のコントラスト');
    await expect(create).toBeVisible();await expect(page.getByRole('heading',{name:'症例検討会と実践講座 第1回',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'症例検討会と実践講座 第2回',exact:true})).toBeVisible();
    await layout('背景が分かれるイベント一覧');await screenshot('event-list');
    await page.getByLabel('イベント種別で絞り込み').selectOption('OTHER');await expect(page.getByText('この種別のイベントはまだ登録されていません',{exact:true})).toBeVisible();await expect(create).toBeVisible();await page.getByLabel('イベント種別で絞り込み').selectOption('ALL');
    await card.click();await expect(page.getByRole('heading',{name:'歯周基本治療セミナー',exact:true})).toBeVisible();
  });
});
