import assert from 'node:assert/strict';
import {createParticipantMailStore} from '../lib/participant-mail.ts';
import {execFileSync} from 'node:child_process';
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


for(const [name,viewport] of [['participant-auto-mail-desktop',{width:1280,height:900}],['participant-auto-mail-mobile',{width:390,height:844}]])await harness(name,viewport,async({page,db,password,step,layout,screenshot})=>{
  await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
  const response=await page.request.post(`${base}/api/seminars`,{headers:{Origin:base},data:{name:'Googleフォームと自動メールの検証',event_type:'BASIC_COURSE',occurrence_type:'SINGLE',dates:['2027-06-01'],fee_dental_hygienist:3000}});assert.equal(response.status(),201);const event=await response.json(),id=event.id,owner=db.prepare('SELECT id FROM auth_users WHERE email=?').get('member@example.invalid').id,store=createParticipantMailStore(db),current=store.read(id);
  const gateway={status:()=>({configured:true,connected:true,email:'sender@example.invalid'})};store.save(id,{settings:{enabled:true,bank_id:1,consultation_url:'',homework:'ベーシックの事前課題です'},version:0,banks:current.banks.map(p=>({...p,details:`架空の口座情報${p.id}`})),banks_version:current.banks_version},owner,gateway);const token=store.rotateToken(id,owner),formEndpoint=`${base}/api/forms/${id}`;
  const payload={response_id:'form-test:response-001',name:'架空の申込者',role:'dental_hygienist',email:'applicant@example.invalid',phone:'',receipt_name:'領収書宛名の架空クリニック'};let pid;
  await step('フォーム回答の認証・重複防止と領収書宛名の取込',async()=>{
    assert.equal((await page.request.post(formEndpoint,{data:payload})).status(),401);
    const submit=()=>page.request.post(formEndpoint,{headers:{Authorization:`Bearer ${token}`},data:payload});const results=await Promise.all([submit(),submit()]);for(const result of results)assert.equal(result.status(),200);
    const rows=await (await page.request.get(`${base}/api/seminars/${id}/participants`)).json();assert.equal(rows.length,1);pid=rows[0].id;assert.equal(rows[0].receipt_name,payload.receipt_name);assert.equal(rows[0].payment_status,'unpaid');assert.equal(rows[0].payment_method,'bank_transfer');
    assert.equal((await page.request.post(formEndpoint,{headers:{Authorization:`Bearer ${token}`},data:{...payload,response_id:'forged-payment',payment_status:'paid'}})).status(),400);
    const settings=await (await page.request.get(`${base}/api/seminars/${id}/participant-mail`)).json();assert.equal(settings.jobs.length,1);assert.equal(settings.jobs[0].kind,'APPLICATION');assert.ok(!JSON.stringify(settings).includes(token));
  });
  await step('参加者名簿で入金確認し領収書PDFの宛名を確認',async()=>{
    await page.goto(`${base}/seminars/${id}/participants`);await expect(page.getByRole('heading',{name:'参加者名簿',exact:true})).toBeVisible();await page.getByRole('button',{name:'未入金',exact:true}).click();const editor=page.getByRole('dialog',{name:'参加者を編集',exact:true});await expect(editor.getByLabel('領収書宛名',{exact:true})).toHaveValue(payload.receipt_name);await expect(editor.getByLabel('確認した入金額（円）')).toHaveValue('3000');await editor.getByRole('button',{name:'保存',exact:true}).click();await expect(editor).toHaveCount(0);
    const settings=await (await page.request.get(`${base}/api/seminars/${id}/participant-mail`)).json();assert.deepEqual(settings.jobs.map(p=>p.kind).sort(),['APPLICATION','PAYMENT']);assert.equal(settings.jobs.filter(p=>p.kind==='PAYMENT').length,1);
    // No real Gmail connection is supplied in browser tests: sends remain queued.
    assert.ok(settings.jobs.every(p=>p.phase==='QUEUED'));assert.equal((await page.request.post(`${base}/api/seminars/${id}/participants/${pid}/receipt`,{headers:{Origin:base}})).status(),200);
    const receipt=await (await page.request.get(`${base}/api/seminars/${id}/participants/${pid}/receipt`)).json();assert.equal(receipt.participant_name,payload.receipt_name);
    const pdf=await page.request.get(`${base}/api/seminars/${id}/participants/${pid}/receipt/pdf`);assert.equal(pdf.status(),200);assert.match(pdf.headers()['content-type'],/application\/pdf/);const bytes=await pdf.body();assert.equal(bytes.subarray(0,5).toString(),'%PDF-');const extracted=execFileSync('pdftotext',['-layout','-','-'],{input:bytes,encoding:'utf8'});assert.ok(extracted.includes(payload.receipt_name));assert.ok(extracted.includes('3,000'));
    assert.equal((await page.request.patch(`${base}/api/seminars/${id}/participants/${pid}`,{headers:{Origin:base},data:{receipt_name:'発行後の変更'}})).status(),409);
  });
  await step('2口座の選択・任意URL・ベーシックの課題を設定する',async()=>{
    const panel=page.getByRole('region',{name:'参加者の自動メール',exact:true});await panel.locator('summary').filter({hasText:'自動メール・Googleフォーム連携の設定'}).click();await panel.getByRole('checkbox',{name:'このイベントの自動送信を有効にする',exact:true}).uncheck();await panel.getByLabel('このイベントの振込先',{exact:true}).selectOption('2');await expect(panel.getByLabel('事前課題',{exact:true})).toHaveValue('ベーシックの事前課題です');
    await panel.getByRole('button',{name:'自動メール設定を保存',exact:true}).click();await expect(panel.getByRole('status')).toContainText('自動メール設定を保存しました');
    await panel.locator('summary').filter({hasText:'申込受付メールのプレビュー'}).click();await expect(panel.locator('pre')).toContainText('架空の口座情報2');await expect(panel.locator('pre')).not.toContainText('臨床のお悩み');await expect(panel.locator('pre')).toContainText('ベーシックの事前課題');
    await layout('自動メール設定');await screenshot('participant-mail-settings');
  });
});
