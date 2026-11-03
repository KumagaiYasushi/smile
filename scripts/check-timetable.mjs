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
  const response=await page.request.post(`${base}/api/seminars`,{headers:{Origin:base},data:{name:'タイムスケジュール検証',occurrence_type:'MULTIPLE',dates:['2027-06-01','2027-06-08'],event_times:{'2027-06-01':{start:'09:00',end:'10:00'}},speakers:[{role:'EXTERNAL_LECTURER',id:null,name:'進行確認用の演者',facility:'検証施設',theme:'歯周基本治療',payment:{travel:1000,honorarium:20000}}]}});assert.equal(response.status(),201);
  const event=await response.json(),endpoint=`${base}/api/seminars/${event.id}/timetable`;
  await step('複数項目と登録演者の講演を追加し時刻を計算',async()=>{
    await page.goto(`${base}/seminars/${event.id}`);await page.getByRole('link',{name:'タイムスケジュール',exact:true}).click();
    await expect(page.getByRole('heading',{name:'タイムスケジュール',exact:true})).toBeVisible();
    const chooser=page.getByRole('group',{name:'追加する項目（複数選択可）',exact:true});
    assert.ok((await chooser.boundingBox()).height<330,'追加項目は初期表示でコンパクト');
    await chooser.getByLabel('項目を選択',{exact:true}).selectOption({label:'挨拶'});await chooser.getByRole('button',{name:'挨拶を追加候補から外す',exact:true}).click();await expect(chooser.getByRole('region',{name:'挨拶の追加設定',exact:true})).toHaveCount(0);
    await chooser.getByLabel('項目を選択',{exact:true}).selectOption({label:'開会の挨拶'});await chooser.getByLabel('開会の挨拶の所要時間（分）',{exact:true}).fill('');await expect(chooser.getByLabel('開会の挨拶の所要時間（分）',{exact:true})).toHaveValue('');await chooser.getByLabel('開会の挨拶の所要時間（分）',{exact:true}).pressSequentially('5');
    await chooser.getByLabel('項目を選択',{exact:true}).selectOption({label:'休憩'});await chooser.getByLabel('休憩の所要時間（分）',{exact:true}).fill('10');
    await chooser.getByLabel('項目を選択',{exact:true}).selectOption({label:'進行確認用の演者の講演：歯周基本治療'});await chooser.getByLabel('進行確認用の演者の講演：歯周基本治療の所要時間（分）',{exact:true}).fill('40');
    await page.getByRole('button',{name:'選択した項目を追加',exact:true}).click();
    await expect(page.getByRole('listitem',{name:'予定 1',exact:true})).toContainText('09:00〜09:05');
    await expect(page.getByRole('listitem',{name:'予定 3',exact:true})).toContainText('09:15〜09:55');
    await expect(page.getByRole('region',{name:'基本情報の講演時間',exact:true})).toContainText('09:00〜10:00（60分）');
    await expect(page.getByText('基本情報の終了まで残り5分',{exact:true})).toBeVisible();
    await layout('初期スケジュール');
  });
  await step('並べ替えと所要時間変更で時刻を再計算し重複項目を追加',async()=>{
    const from=page.getByRole('button',{name:'予定 3をドラッグして移動',exact:true}),target=page.getByRole('listitem',{name:'予定 2',exact:true});
    if(viewport.width>=600){await from.dragTo(target,{targetPosition:{x:30,y:30}});}else{
      await target.evaluate(el=>el.scrollIntoView({block:'center'}));
      // Real touch events verify pointer capture and touch dragging, not synthetic DOM handlers.
      const a=await from.boundingBox(),b=await target.boundingBox();assert.ok(a&&b);
      const cdp=await page.context().newCDPSession(page);const x=a.x+a.width/2,y=a.y+a.height/2;
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let i=1;i<=10;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(b.x+30-x)*i/10,y:y+(b.y+30-y)*i/10}]});
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();
    }
    await expect(page.getByRole('listitem',{name:'予定 2',exact:true})).toContainText('09:05〜09:45');
    const duration=page.getByRole('listitem',{name:'予定 2',exact:true}).getByLabel('所要時間（分）',{exact:true});await duration.fill('');await expect(duration).toHaveValue('');await duration.pressSequentially('50');await expect(duration).toHaveValue('50');
    const editedTitle=page.getByRole('listitem',{name:'予定 2',exact:true}).getByLabel('項目名',{exact:true});await editedTitle.fill('変更後の講演タイトル');
    await expect(page.getByText('基本情報の終了時刻を5分超過',{exact:true})).toBeVisible();
    await expect(page.getByRole('listitem',{name:'予定 3',exact:true})).toContainText('09:55〜10:05');
    const chooser=page.getByRole('group',{name:'追加する項目（複数選択可）',exact:true});await chooser.getByLabel('項目を選択',{exact:true}).selectOption({label:'休憩'});await page.getByRole('button',{name:'選択した項目を追加',exact:true}).click();
    await expect(page.getByRole('listitem',{name:'予定 4',exact:true})).toContainText('10:05〜10:15');
    await page.getByRole('listitem',{name:'予定 4',exact:true}).getByRole('button',{name:'削除',exact:true}).click();
    await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('status')).toContainText('タイムスケジュールを保存しました');
    const saved=await (await page.request.get(endpoint)).json();assert.deepEqual(saved.days[0].items.map(p=>p.type),['OPENING','LECTURE','BREAK']);assert.equal(saved.days[0].items[1].minutes,50);assert.equal(saved.days[0].items[1].title,'変更後の講演タイトル');assert.ok(!JSON.stringify(saved).includes('honorarium'));
    await screenshot('timetable');
  });
  await step('日別の保持・再取得・競合と保存失敗時の入力保持',async()=>{
    await page.reload();await expect(page.getByRole('listitem',{name:'予定 2',exact:true})).toContainText('09:05〜09:55');await expect(page.getByRole('listitem',{name:'予定 2',exact:true}).getByLabel('項目名',{exact:true})).toHaveValue('変更後の講演タイトル');
    await page.getByLabel('対象の日程',{exact:true}).selectOption('1');await expect(page.getByRole('listitem',{name:'予定 1',exact:true})).toHaveCount(0);
    await page.getByLabel('対象の日程',{exact:true}).selectOption('0');
    const current=await (await page.request.get(endpoint)).json();assert.equal((await page.request.put(endpoint,{headers:{Origin:base},data:{version:current.version,days:current.days}})).status(),200);
    const title=page.getByRole('listitem',{name:'予定 1',exact:true}).getByLabel('項目名',{exact:true});await title.fill('競合しても残る挨拶');
    await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'更新されています'})).toBeVisible();await expect(title).toHaveValue('競合しても残る挨拶');
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'最新の予定を再取得',exact:true}).click();await expect(title).toHaveValue('開会の挨拶');
    assert.equal((await page.request.put(endpoint,{data:{version:1,days:[]}})).status(),403);
    await layout('編集後のスケジュール');
  });
  await step('新しい3項目と演者講演を個数指定で追加・個別編集・保存',async()=>{
    await page.getByLabel('対象の日程',{exact:true}).selectOption('1');
    const chooser=page.getByRole('group',{name:'追加する項目（複数選択可）',exact:true});
    const entries=[['昼休憩',2,60],['ディスカッション',1,30],['グループディスカッション',3,30],['進行確認用の演者の講演：歯周基本治療',2,30]];
    for(const [label,,minutes] of entries){await chooser.getByLabel('項目を選択',{exact:true}).selectOption({label:label});await chooser.getByLabel(`${label}の所要時間（分）`,{exact:true}).fill(String(minutes));}
    const colors=await Promise.all(entries.map(([label])=>chooser.getByRole('region',{name:`${label}の追加設定`,exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor)));assert.equal(new Set(colors).size,4);
    const quantity=chooser.getByLabel('昼休憩の追加する数',{exact:true});await quantity.fill('');await expect(quantity).toHaveValue('');await quantity.pressSequentially('0');
    await page.getByRole('button',{name:'選択した項目を追加',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'追加する数は'})).toBeVisible();await expect(page.getByRole('listitem',{name:'予定 1',exact:true})).toHaveCount(0);
    await quantity.fill('200');await page.getByRole('button',{name:'選択した項目を追加',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'200件以内'})).toBeVisible();
    for(const [label,count] of entries)await chooser.getByLabel(`${label}の追加する数`,{exact:true}).fill(String(count));
    await page.getByRole('button',{name:'選択した項目を追加',exact:true}).click();
    await expect(page.getByRole('listitem',{name:'予定 8',exact:true})).toContainText('13:30〜14:00');
    const first=page.getByRole('listitem',{name:'予定 1',exact:true});assert.equal(await first.evaluate(el=>getComputedStyle(el).backgroundColor),colors[0]);assert.equal(await page.getByRole('listitem',{name:'予定 2',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),colors[0]);assert.equal(await page.getByRole('listitem',{name:'予定 4',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),colors[2]);await first.getByLabel('項目名',{exact:true}).fill('昼休憩・前半');
    await expect(page.getByRole('listitem',{name:'予定 2',exact:true}).getByLabel('項目名',{exact:true})).toHaveValue('昼休憩');
    await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('status')).toContainText('保存しました');
    const saved=await (await page.request.get(endpoint)).json(),items=saved.days.find(p=>p.date==='2027-06-08').items;
    assert.equal(items.length,8);assert.equal(new Set(items.map(p=>p.id)).size,8);assert.deepEqual(['LUNCH_BREAK','DISCUSSION','GROUP_DISCUSSION','LECTURE'].map(type=>items.filter(p=>p.type===type).length),[2,1,3,2]);
    await page.reload();await page.getByLabel('対象の日程',{exact:true}).selectOption('1');await expect(page.getByRole('listitem',{name:'予定 1',exact:true}).getByLabel('項目名',{exact:true})).toHaveValue('昼休憩・前半');
    await layout('個数指定');await screenshot('quantities');
  });

});
