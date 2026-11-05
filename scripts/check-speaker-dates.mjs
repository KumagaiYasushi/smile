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


for(const [name,viewport] of [['speaker-dates-desktop',{width:1280,height:900}],['speaker-dates-mobile',{width:390,height:844}]])await harness(name,viewport,async({page,password,step,layout,screenshot})=>{
  await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
  let eventId,saved;
  const dates=['2027-06-01','2027-06-08'];
  await step('複数回のイベントで日別に同じ外部講師と研究会メンバーを登録',async()=>{
    await page.goto(`${base}/seminars/new`);await page.getByLabel('セミナー名',{exact:false}).fill('日別演者の検証');await page.getByLabel('開催回数',{exact:false}).selectOption('MULTIPLE');
    await page.getByLabel('開催日 1',{exact:true}).fill(dates[0]);await page.getByRole('button',{name:'＋ 日程を追加',exact:true}).click();await page.getByLabel('開催日 2',{exact:true}).fill(dates[1]);
    for(const date of dates)await page.getByLabel(`${date}の開催方法`,{exact:true}).selectOption('ONSITE');
    await page.locator('[data-form-section="演者・テーマ"] > summary').click();
    for(let i=0;i<4;i++){
      const dateGroup=page.getByRole('region',{name:`${dates[i%2]}の演者登録`,exact:true});
      await dateGroup.getByRole('button',{name:`${dates[i%2]}に演者を追加`,exact:true}).click();const card=page.getByRole('group',{name:`演者 ${i+1}`,exact:true});
      await expect(card.getByLabel('登壇日',{exact:true})).toHaveValue(dates[i%2]);
      await expect(dateGroup.getByRole('group',{name:`演者 ${i+1}`,exact:true})).toBeVisible();
      await card.getByLabel('演者区分',{exact:true}).selectOption(i<2?'EXTERNAL_LECTURER':'SOCIETY_SUPPORT');
      if(i<2){await card.getByLabel('氏名',{exact:true}).fill('日別で再登壇する外部講師');await card.getByLabel('勤務施設名',{exact:true}).fill('日別検証施設');await card.getByLabel('お車代（円）',{exact:true}).fill(String((i+1)*1000));await card.getByLabel('謝礼（円）',{exact:true}).fill(String((i+1)*10000));}
      else{await expect(card.getByLabel('名簿から選択').locator('option')).not.toHaveCount(1);await card.getByLabel('名簿から選択').selectOption({index:1});}
      await card.getByLabel('テーマ',{exact:true}).fill(`第${i%2+1}回の${i<2?'外部講師':'サポート'}テーマ`);
    }
    for(const date of dates)await expect(page.getByRole('region',{name:`${date}の演者登録`,exact:true}).getByText('登録済み：2名',{exact:true})).toBeVisible();
    await expect(page.getByRole('region',{name:'全開催日共通の演者登録',exact:true})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'全開催日共通の演者を追加',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'入力を閉じる',exact:true}).click();await expect(page.locator('[data-speaker-editor][open]')).toHaveCount(0);
    assert.ok(await page.locator('[data-form-section="演者・テーマ"]').evaluate(el=>el.getBoundingClientRect().height)<1300,'演者4名をコンパクトな一覧で表示');
    await layout('日別の演者登録');await screenshot('registration');
    await page.route(`${base}/api/seminars`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'日別演者の保存失敗テスト'})}),{times:1});
    await page.getByRole('button',{name:'登録する',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'日別演者の保存失敗テスト'})).toBeVisible();
    await expect(page.getByRole('group',{name:'演者 2',exact:true}).getByLabel('登壇日')).toHaveValue(dates[1]);
    await page.getByRole('button',{name:'登録する',exact:true}).click();await page.waitForURL(/\/seminars\/\d+$/);eventId=new URL(page.url()).pathname.split('/').pop();
    saved=await (await page.request.get(`${base}/api/seminars/${eventId}`)).json();assert.equal(saved.speakers.length,4);assert.equal(saved.speakers[0].id,saved.speakers[1].id);assert.equal(saved.speakers[2].id,saved.speakers[3].id);assert.deepEqual(saved.speakers.map(p=>p.date),[...dates,...dates]);assert.deepEqual(saved.external_payment,{travel:3000,honorarium:30000});
    const directory=await (await page.request.get(`${base}/api/external-lecturers`)).json();assert.equal(directory.lecturers.filter(p=>p.name==='日別で再登壇する外部講師').length,1);
  });
  await step('再編集で登壇日とテーマを保持し片方の日だけ変更',async()=>{
    await page.goto(`${base}/seminars/${eventId}/edit`);await page.locator('[data-form-section="演者・テーマ"] > summary').click();
    for(let i=0;i<4;i++){const card=page.getByRole('group',{name:`演者 ${i+1}`,exact:true});await expect(card.getByLabel('登壇日')).toHaveValue(dates[i%2]);await expect(card.getByLabel('テーマ')).toHaveValue(saved.speakers[i].theme);}
    await expect(page.getByRole('region',{name:`${dates[0]}の演者登録`,exact:true}).getByRole('group',{name:'演者 1',exact:true})).toBeVisible();
    await expect(page.getByRole('region',{name:`${dates[1]}の演者登録`,exact:true}).getByRole('group',{name:'演者 2',exact:true})).toBeVisible();
    await page.getByRole('group',{name:'演者 2',exact:true}).locator('summary').click();await expect(page.locator('[data-speaker-editor][open]')).toHaveCount(1);
    await page.getByRole('group',{name:'演者 2',exact:true}).getByLabel('テーマ').fill('第2回だけ変更したテーマ');await page.getByRole('button',{name:'変更を保存',exact:true}).click();await page.waitForURL(/\/seminars\/\d+$/);
    const updated=await (await page.request.get(`${base}/api/seminars/${eventId}`)).json();assert.equal(updated.speakers[0].theme,saved.speakers[0].theme);assert.equal(updated.speakers[1].theme,'第2回だけ変更したテーマ');
  });
  await step('タイムスケジュールの候補・テーマを開催日ごとに切り替えて保存',async()=>{
    await page.goto(`${base}/seminars/${eventId}/timetable`);
    for(let i=0;i<2;i++){
      await page.getByLabel('対象の日程',{exact:true}).selectOption(String(i));const chooser=page.getByLabel('項目を選択',{exact:true});
      const options=await chooser.locator('optgroup[label="登録演者の講演"] option').allTextContents();assert.equal(options.length,2);assert.ok(options.every(p=>p.includes(i===0?'第1回':'第2回')));
      await chooser.selectOption({label:options[0]});await page.getByRole('button',{name:'選択した項目を追加',exact:true}).click();await expect(page.getByRole('listitem',{name:'予定 1',exact:true})).toContainText(i===0?'第1回':'第2回');
    }
    await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('status')).toContainText('保存しました');
    const timetable=await (await page.request.get(`${base}/api/seminars/${eventId}/timetable`)).json();assert.notEqual(timetable.days[0].items[0].speaker_key,timetable.days[1].items[0].speaker_key);
    const wrong=structuredClone(timetable.days);wrong[1].items[0]={...wrong[0].items[0],id:'forged-different-day'};
    assert.equal((await page.request.put(`${base}/api/seminars/${eventId}/timetable`,{headers:{Origin:base},data:{version:timetable.version,days:wrong}})).status(),400);
    await layout('日別の講演候補');await screenshot('timetable');
  });
  await step('以前の共通設定を消さずに登壇日へ振り分ける',async()=>{
    const person={...saved.speakers[2]};delete person.date;
    const response=await page.request.post(`${base}/api/seminars`,{headers:{Origin:base},data:{name:'旧演者設定の確認',occurrence_type:'MULTIPLE',dates,session_delivery_methods:Object.fromEntries(dates.map(date=>[date,'ONSITE'])),speakers:[person]}});assert.equal(response.status(),201);
    const legacy=await response.json();await page.goto(`${base}/seminars/${legacy.id}/edit`);await page.locator('[data-form-section="演者・テーマ"] > summary').click();
    const pending=page.getByRole('region',{name:'登壇日の指定が必要な演者',exact:true});await expect(pending).toContainText(person.name);
    await expect(page.getByRole('button',{name:'全開催日共通の演者を追加',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'変更を保存',exact:true}).click();
    const date=pending.getByLabel('登壇日',{exact:true});await expect(date).toBeVisible();await expect(date).toHaveAttribute('aria-invalid','true');
    await expect(date.locator('option').filter({hasText:'全開催日共通'})).toHaveCount(0);
    await date.selectOption(dates[1]);await expect(pending).toHaveCount(0);
    const dated=page.getByRole('region',{name:`${dates[1]}の演者登録`,exact:true});await expect(dated).toContainText(person.name);await expect(dated.getByLabel('テーマ')).toHaveValue(person.theme);
    await page.getByRole('button',{name:'変更を保存',exact:true}).click();await page.waitForURL(/\/seminars\/\d+$/);
    const result=await (await page.request.get(`${base}/api/seminars/${legacy.id}`)).json();assert.equal(result.speakers[0].date,dates[1]);assert.equal(result.speakers[0].theme,person.theme);
  });

});
