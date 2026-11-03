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



for(const [name,viewport] of [['timetable-desktop',{width:1280,height:900}],['timetable-mobile',{width:390,height:844}]])await harness(name,viewport,async({page,password,step,layout,screenshot})=>{
  await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
  const response=await page.request.post(`${base}/api/seminars`,{headers:{Origin:base},data:{name:'タイムスケジュール検証',occurrence_type:'MULTIPLE',dates:['2027-06-01','2027-06-08'],event_times:{'2027-06-01':{start:'09:00',end:'17:00'}},speakers:[{role:'EXTERNAL_LECTURER',id:null,name:'進行確認用の演者',facility:'検証施設',theme:'歯周基本治療',payment:{travel:1000,honorarium:20000}}]}});assert.equal(response.status(),201);
  const event=await response.json(),endpoint=`${base}/api/seminars/${event.id}/timetable`;
  await step('複数項目と登録演者の講演を追加し時刻を計算',async()=>{
    await page.goto(`${base}/seminars/${event.id}`);await page.getByRole('link',{name:'タイムスケジュール',exact:true}).click();
    await expect(page.getByRole('heading',{name:'タイムスケジュール',exact:true})).toBeVisible();
    const chooser=page.getByRole('group',{name:'追加する項目（複数選択可）',exact:true});
    await chooser.getByRole('checkbox',{name:'開会の挨拶',exact:true}).check();await chooser.getByLabel('開会の挨拶の所要時間（分）',{exact:true}).fill('5');
    await chooser.getByRole('checkbox',{name:'休憩',exact:true}).check();await chooser.getByLabel('休憩の所要時間（分）',{exact:true}).fill('10');
    await chooser.getByRole('checkbox',{name:'進行確認用の演者の講演：歯周基本治療',exact:true}).check();await chooser.getByLabel('進行確認用の演者の講演：歯周基本治療の所要時間（分）',{exact:true}).fill('40');
    await page.getByRole('button',{name:'選択した項目を追加',exact:true}).click();
    await expect(page.getByRole('listitem',{name:'予定 1',exact:true})).toContainText('09:00〜09:05');
    await expect(page.getByRole('listitem',{name:'予定 3',exact:true})).toContainText('09:15〜09:55');
    await layout('初期スケジュール');
  });
  await step('並べ替えと所要時間変更で時刻を再計算し重複項目を追加',async()=>{
    await page.getByRole('listitem',{name:'予定 3',exact:true}).getByRole('button',{name:'上へ',exact:true}).click();
    await expect(page.getByRole('listitem',{name:'予定 2',exact:true})).toContainText('09:05〜09:45');
    await page.getByRole('listitem',{name:'予定 2',exact:true}).getByLabel('所要時間（分）',{exact:true}).fill('50');
    await expect(page.getByRole('listitem',{name:'予定 3',exact:true})).toContainText('09:55〜10:05');
    const chooser=page.getByRole('group',{name:'追加する項目（複数選択可）',exact:true});await chooser.getByRole('checkbox',{name:'休憩',exact:true}).check();await page.getByRole('button',{name:'選択した項目を追加',exact:true}).click();
    await expect(page.getByRole('listitem',{name:'予定 4',exact:true})).toContainText('10:05〜10:15');
    await page.getByRole('listitem',{name:'予定 4',exact:true}).getByRole('button',{name:'削除',exact:true}).click();
    await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('status')).toContainText('タイムスケジュールを保存しました');
    const saved=await (await page.request.get(endpoint)).json();assert.deepEqual(saved.days[0].items.map(p=>p.type),['OPENING','LECTURE','BREAK']);assert.equal(saved.days[0].items[1].minutes,50);assert.ok(!JSON.stringify(saved).includes('honorarium'));
    await screenshot('timetable');
  });
  await step('日別の保持・再取得・競合と保存失敗時の入力保持',async()=>{
    await page.reload();await expect(page.getByRole('listitem',{name:'予定 2',exact:true})).toContainText('09:05〜09:55');
    await page.getByLabel('対象の日程',{exact:true}).selectOption('1');await expect(page.getByRole('listitem',{name:'予定 1',exact:true})).toHaveCount(0);
    await page.getByLabel('対象の日程',{exact:true}).selectOption('0');
    const current=await (await page.request.get(endpoint)).json();assert.equal((await page.request.put(endpoint,{headers:{Origin:base},data:{version:current.version,days:current.days}})).status(),200);
    const title=page.getByRole('listitem',{name:'予定 1',exact:true}).getByLabel('項目名',{exact:true});await title.fill('競合しても残る挨拶');
    await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'更新されています'})).toBeVisible();await expect(title).toHaveValue('競合しても残る挨拶');
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'最新の予定を再取得',exact:true}).click();await expect(title).toHaveValue('開会の挨拶');
    assert.equal((await page.request.put(endpoint,{data:{version:1,days:[]}})).status(),403);
    await layout('編集後のスケジュール');
  });
});
