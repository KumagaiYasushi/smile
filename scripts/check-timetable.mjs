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
 const events=[];for(const [event_type,name] of [['BASIC_COURSE','架空：ベーシック'],['LECTURE','架空：講演会'],['SEMINAR','架空：セミナー'],['OTHER','架空：その他']]){const r=await page.request.post(`${base}/api/seminars`,{headers:{Origin:base},data:{event_type,name,occurrence_type:'SINGLE',dates:['2027-06-01'],event_times:{'2027-06-01':{start:'09:00',end:'17:00'}},speakers:[{role:'EXTERNAL_LECTURER',id:null,name:'架空講師',facility:'架空施設',theme:'臨床',payment:{travel:null,honorarium:null}}]}});assert.equal(r.status(),201);const event=await r.json();events.push(event);const task=await page.request.post(`${base}/api/seminars/${event.id}/tasks`,{headers:{Origin:base},data:{title:'配色を確認する準備',description:'',due_date:null,important:false}});assert.equal(task.status(),201);}
 await step('一覧・ダッシュボード・HOMEで同じ種別色を確認',async()=>{
  await page.goto(base+'/');const colors={};for(const e of events){const cards=page.locator(`[data-event-type="${e.event_type}"]`);await expect(cards).toHaveCount(1);colors[e.event_type]=await cards.evaluate(el=>getComputedStyle(el).backgroundColor);}
  assert.equal(new Set(Object.values(colors)).size,4);await screenshot('event-colors');
  await page.goto(base+'/dashboard');for(const e of events){const cards=page.locator(`article[data-event-type="${e.event_type}"]`);await expect(cards.first()).toBeVisible();assert.equal(await cards.first().evaluate(el=>getComputedStyle(el).backgroundColor),colors[e.event_type]);}await layout('ダッシュボード');await screenshot('dashboard-colors');
  await page.goto(base+'/home');for(const e of events){const row=page.locator(`[data-event-type="${e.event_type}"]`).first();await expect(row).toBeVisible();assert.equal(await row.evaluate(el=>getComputedStyle(el).backgroundColor),colors[e.event_type]);}
 });
 const event=events[2],endpoint=`${base}/api/seminars/${event.id}/timetable`;
 await page.goto(`${base}/seminars/${event.id}/timetable`);const chooser=page.getByRole('group',{name:'追加する項目',exact:true}),select=chooser.getByLabel('項目を選択',{exact:true});
 const row=n=>page.getByRole('listitem',{name:`予定 ${n}`,exact:true});
 await step('選択した順で即時追加し個数・登録演者・時間変更を確認',async()=>{
  await expect(select).toBeVisible();await expect(page.getByRole('button',{name:'選択した項目を追加',exact:true})).toHaveCount(0);
  await select.selectOption('BREAK');await expect(row(1)).toContainText('休憩');await select.selectOption('OPENING');await expect(row(2)).toContainText('開会の挨拶');await chooser.getByLabel('追加する数',{exact:true}).fill('2');await select.selectOption('PRACTICE_INDIVIDUAL');await expect(row(3)).toContainText('実習(個人)');await expect(row(4)).toContainText('実習(個人)');
  await chooser.getByLabel('追加する数',{exact:true}).fill('1');await select.selectOption({label:'架空講師の講演：臨床'});await expect(row(5)).toContainText('架空講師');await row(5).getByLabel('所要時間（分）',{exact:true}).fill('');await row(5).getByLabel('所要時間（分）',{exact:true}).pressSequentially('40');await expect(row(5).getByLabel('所要時間（分）',{exact:true})).toHaveValue('40');
  const order=await page.getByRole('listitem').allTextContents();await row(5).getByRole('button',{name:'上へ',exact:true}).click();await expect(row(4)).toContainText('架空講師');assert.notDeepEqual(await page.getByRole('listitem').allTextContents(),order);const from=row(1).getByRole('button',{name:'予定 1をドラッグして移動',exact:true}),target=row(2);await target.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));if(viewport.width>=600)await from.dragTo(target,{targetPosition:{x:30,y:30}});else{const a=await from.boundingBox(),b=await target.boundingBox();assert.ok(a&&b);const cdp=await page.context().newCDPSession(page),x=a.x+a.width/2,y=a.y+a.height/2;await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(b.x+30-x)*i/10,y:y+(b.y+30-y)*i/10}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();}await expect(row(1)).toContainText('開会の挨拶');await layout('即時追加');await screenshot('instant-items');
 });
 await step('不正な個数では追加せず、保存後も順序・所要時間を保持',async()=>{
  await chooser.getByLabel('追加する数',{exact:true}).fill('0');await select.selectOption('BREAK');await expect(page.getByRole('alert').filter({hasText:'追加する数は'})).toBeVisible();await expect(page.locator('[data-timetable-item]')).toHaveCount(5);
  await chooser.getByLabel('追加する数',{exact:true}).fill('200');await select.selectOption('BREAK');await expect(page.getByRole('alert').filter({hasText:'200件以内'})).toBeVisible();await expect(page.locator('[data-timetable-item]')).toHaveCount(5);
  await chooser.getByLabel('追加する数',{exact:true}).fill('1');await select.selectOption('BREAK');await expect(row(6)).toContainText('休憩');await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('status')).toContainText('保存しました');await page.reload();await expect(row(6)).toContainText('休憩');const result=await(await page.request.get(endpoint)).json();assert.deepEqual(result.days[0].items.map(p=>p.type),['OPENING','BREAK','PRACTICE_INDIVIDUAL','LECTURE','PRACTICE_INDIVIDUAL','BREAK']);assert.equal(result.days[0].items[3].minutes,40);
 });
});
