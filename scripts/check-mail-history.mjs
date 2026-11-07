import assert from 'node:assert/strict';
import {createMailHistoryStore} from '../lib/mail-history.ts';
import {renderReceiptPdf} from '../lib/receipt-pdf.ts';
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


for(const [name,viewport] of [['mail-history-desktop',{width:1280,height:900}],['mail-history-mobile',{width:390,height:844}]])await harness(name,viewport,async({page,db,password,step,layout,screenshot})=>{
  await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
  async function event(name){const r=await page.request.post(`${base}/api/seminars`,{headers:{Origin:base},data:{name,event_type:'SEMINAR',occurrence_type:'SINGLE',dates:[]}});assert.equal(r.status(),201);return r.json();}
  const first=await event('履歴用イベントA'),second=await event('履歴用イベントB'),history=createMailHistoryStore(db),actor=db.prepare('SELECT id FROM auth_users WHERE email=?').get('member@example.invalid').id;
  const receipt={id:100,seminar_id:first.id,participant_id:100,receipt_number:'ARCHIVE-100',participant_name:'履歴の領収書宛名',participant_role:'dentist',event_name:first.name,event_dates:[],venue:'',lecturer_name:'',amount:5000,issue_date:'2027-06-03',actor_id:actor,issued_at:'2027-06-03T00:00:00Z'},pdf=await renderReceiptPdf(receipt);
  const messages=[{source:'TASK',source_id:1001,event_id:first.id,event_name:first.name,kind:'TASK',subject:'講師への依頼状',started_at:'2027-06-01T00:00:00Z'},{source:'PARTICIPANT',source_id:1002,event_id:second.id,event_name:second.name,kind:'APPLICATION',subject:'申込受付のお礼',started_at:'2027-06-02T00:00:00Z'},{source:'PARTICIPANT',source_id:1003,event_id:first.id,event_name:first.name,kind:'PAYMENT',subject:'入金確認と領収書',started_at:'2027-06-03T00:00:00Z',attachment_pdf:pdf,receipt}];
  for(const row of messages){const data={recipient:'recipient@example.invalid',recipient_name:'送信先のお名前',sender:'sender@example.invalid',body:`保存した本文：${row.subject}\nhttps://example.invalid/`,message_id:`<history-${row.source_id}>`,owner_id:actor,...row};history.capture(data);history.confirm(data.source,data.source_id,data.message_id,data.started_at,'gmail-id');}
  const pending={source:'TASK',source_id:9999,event_id:first.id,event_name:first.name,kind:'TASK',subject:'送信結果不明',started_at:'2020-01-01T00:00:00Z',recipient:'unknown@example.invalid',sender:'sender@example.invalid',body:'未確認の本文',message_id:'<unknown>',owner_id:actor};history.capture(pending);history.failed(pending.source,pending.source_id,pending.message_id,false);
  async function menu(){const button=page.getByRole('button',{name:'システムメニューを開く',exact:true});if(await button.isVisible())await button.click();}
  await step('全種類のメールを日本時間の時系列で表示し本文・添付を開く',async()=>{
    await menu();await page.getByRole('link',{name:'メール送信履歴',exact:true}).click();await expect(page.getByRole('heading',{name:'メール送信履歴',exact:true})).toBeVisible();
    const subjects=page.getByRole('list',{name:'送信済みメールの時系列一覧',exact:true}).getByRole('heading',{level:2});await expect(subjects).toHaveText(['入金確認と領収書','申込受付のお礼','講師への依頼状']);await expect(page.getByText('送信済み 3件',{exact:true})).toBeVisible();await expect(page.getByText(/送信処理中・結果未確認：1件/)).toBeVisible();assert.match(await page.locator('time').first().innerText(),/9:00:00|09:00:00/);
    const card=page.getByRole('article',{name:'入金確認と領収書',exact:true});await card.getByRole('button',{name:'本文・添付を確認',exact:true}).click();await expect(card).toContainText('保存した本文：入金確認と領収書');const href=await card.getByRole('link',{name:'送信した領収書PDFをダウンロード',exact:true}).getAttribute('href'),response=await page.request.get(base+href);assert.equal(response.status(),200);assert.equal((await response.body()).compare(pdf),0);
    const anonymous=await page.context().browser().newContext();try{assert.equal((await anonymous.request.get(`${base}/api/mail-history`)).status(),401);assert.equal((await anonymous.request.get(base+href)).status(),401);}finally{await anonymous.close();}
    assert.equal((await page.request.get(`${base}/api/mail-history?page=0`)).status(),400);await layout('メール送信履歴');await screenshot('history');
  });
  await step('並び順・種類・イベント・宛先検索で絞り込む',async()=>{
    await page.getByLabel('履歴の表示順').selectOption('asc');await expect(page.getByRole('list',{name:'送信済みメールの時系列一覧',exact:true}).getByRole('heading',{level:2}).first()).toHaveText('講師への依頼状');await page.getByLabel('メールの種類').selectOption('PAYMENT');await expect(page.getByText('送信済み 1件',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'絞り込みを解除',exact:true}).click();await expect(page.getByText('送信済み 3件',{exact:true})).toBeVisible();await page.getByLabel('履歴のイベント').selectOption(String(second.id));await expect(page.getByText('送信済み 1件',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'絞り込みを解除',exact:true}).click();await page.getByLabel('宛先・氏名・件名で検索').fill('講師');await page.getByRole('button',{name:'検索',exact:true}).click();await expect(page.getByText('送信済み 1件',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'絞り込みを解除',exact:true}).click();await expect(page.getByText('送信済み 3件',{exact:true})).toBeVisible();await page.getByRole('button',{name:'検索',exact:true}).click();await expect(page.getByText('送信済み 3件',{exact:true})).toBeVisible();
    await page.goto(`${base}/seminars/${second.id}`);await page.getByRole('link',{name:'このイベントの送信履歴',exact:true}).click();await expect(page.getByLabel('履歴のイベント')).toHaveValue(String(second.id));await expect(page.getByText('送信済み 1件',{exact:true})).toBeVisible();await menu();await page.getByRole('link',{name:'メール送信履歴',exact:true}).click();await expect(page.getByLabel('履歴のイベント')).toHaveValue('ALL');await expect(page.getByText('送信済み 3件',{exact:true})).toBeVisible();
  });
  await step('元イベント削除後も本文と領収書を保持し全件ページ送りできる',async()=>{
    assert.equal((await page.request.delete(`${base}/api/seminars/${first.id}`,{headers:{Origin:base}})).status(),200);await page.getByRole('button',{name:'最新の履歴を取得',exact:true}).click();await expect(page.getByText('送信済み 3件',{exact:true})).toBeVisible();const card=page.getByRole('article',{name:'入金確認と領収書',exact:true});await expect(card).toContainText('元のイベントは削除済み');await expect(card.getByRole('link',{name:'イベントを開く',exact:true})).toHaveCount(0);await card.getByRole('button',{name:'本文・添付を確認',exact:true}).click();const href=await card.getByRole('link',{name:'送信した領収書PDFをダウンロード',exact:true}).getAttribute('href');assert.equal((await page.request.get(base+href)).status(),200);
    for(let i=1;i<=55;i++){const row={...pending,source_id:2000+i,event_id:second.id,event_name:second.name,subject:`ページ確認${i}`,message_id:`<page-${i}>`,started_at:'2026-01-01T00:00:00Z'};history.capture(row);history.confirm(row.source,row.source_id,row.message_id,row.started_at,'gmail-page');}
    await page.getByRole('button',{name:'最新の履歴を取得',exact:true}).click();await expect(page.getByText('送信済み 58件',{exact:true})).toBeVisible();const list=page.getByRole('list',{name:'送信済みメールの時系列一覧',exact:true});await expect(list.locator(':scope > li')).toHaveCount(50);await page.getByRole('button',{name:'次へ',exact:true}).click();await expect(list.locator(':scope > li')).toHaveCount(8);await expect(page.getByText('2 / 2 ページ',{exact:true})).toBeVisible();await page.getByRole('button',{name:'前へ',exact:true}).click();await expect(list.locator(':scope > li')).toHaveCount(50);await layout('履歴の全件表示');
  });
});
