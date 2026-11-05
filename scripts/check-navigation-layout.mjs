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
const base = 'http://localhost:3202';
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
    server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3202'], {
      cwd: process.cwd(), env: { ...process.env, SMILE_DATA_DIR: directory, AUTH_MFA_KEY: key, APP_ORIGIN: base, SMILE_VERIFICATION_MODE:'1', SMILE_VERIFICATION_EPHEMERAL:'1' }, stdio: ['ignore', 'pipe', 'pipe'],
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





for(const [name,viewport] of [['navigation-desktop',{width:1280,height:900}],['navigation-mobile',{width:390,height:844}],['navigation-narrow',{width:320,height:700}],['navigation-iphone',{width:430,height:932}],['navigation-tablet',{width:768,height:900}]])await harness(name,viewport,async({page,password,step,layout,screenshot})=>{
  await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
  const name='画面幅を確認するイベント'+'LongSeminarTitle'.repeat(9),venue='【架空】検証用会議室／テストルームA／架空県テスト市サンプルビル '+ 'LongAddressWithoutSpaces'.repeat(15);
  const response=await page.request.post(`${base}/api/seminars`,{headers:{Origin:base},data:{name,event_type:'LECTURE',occurrence_type:'SINGLE',dates:['2027-06-15'],delivery_method:'ONSITE',lecturer_name:'【架空】講師A'+ 'LongSpeakerName'.repeat(9),venue}});assert.equal(response.status(),201);
  await page.goto(base);const workspace=page.getByRole('region',{name:'表示・入力エリア',exact:true});
  await step('長いイベント名・講師名・住所でも横にはみ出さない',async()=>{
    const card=page.getByRole('link').filter({has:page.getByRole('heading',{name,exact:true})});await expect(card).toBeVisible();await layout('長いイベント情報');
    const bounds=await card.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=viewport.width+1);
    const address=card.getByText(venue,{exact:true});await expect(address).toBeVisible();assert.ok((await address.boundingBox()).height>32,'長い住所は切り捨てず折り返す');
    assert.notEqual(await page.evaluate(()=>getComputedStyle(document.documentElement).overflowX),'hidden');
    await screenshot('event-list');
  });
  await step('メニューと表示入力領域を分けて開閉で画面を動かさない',async()=>{
    const nav=page.getByRole('navigation',{name:'システムメニュー',exact:true});
    if(viewport.width>=1024){await expect(nav).toBeVisible();const a=await page.getByRole('complementary',{name:'ナビゲーションエリア',exact:true}).boundingBox(),b=await workspace.boundingBox();assert.ok(a.width>=260);assert.ok(b.x>=a.x+a.width+15);}
    else {
      await expect(nav).toBeHidden();const button=page.getByRole('button',{name:'システムメニューを開く',exact:true});await button.scrollIntoViewIfNeeded();
      const before=await workspace.boundingBox(),scroll=await page.evaluate(()=>scrollY);await button.click();await expect(nav).toBeVisible();
      const after=await workspace.boundingBox();assert.ok(Math.abs(after.y-before.y)<=1);assert.equal(await page.evaluate(()=>scrollY),scroll);
      const panel=await page.locator('#system-menu-panel').boundingBox();assert.ok(panel.width>=before.width*0.9);assert.ok(panel.y+panel.height<=viewport.height+1,'検証用の案内があってもメニュー全体を画面内に表示');await layout('全幅メニュー');await screenshot('menu-open');
      await page.keyboard.press('Escape');await expect(nav).toBeHidden();await expect(button).toBeFocused();assert.ok(Math.abs((await workspace.boundingBox()).y-before.y)<=1);
      await button.click();await page.mouse.click(viewport.width-4,8);await expect(nav).toBeHidden();
    }
  });
  await step('編集フォームも画面内に収め通常のスクロールを維持',async()=>{
    await page.goto(`${base}/seminars/new`);await page.getByRole('button',{name:'すべて開く',exact:true}).click();await layout('全項目を開いたフォーム');
    await page.getByLabel('セミナー名',{exact:false}).fill('幅が揃った入力フォーム');await screenshot('event-form');
    const old=await page.evaluate(()=>scrollY);await page.mouse.wheel(0,250);await page.waitForFunction(y=>scrollY>y+20,old);
  });
});
