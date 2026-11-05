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


await harness('speaker-selection-task-mail', {width:390,height:844}, async ({page,password,step,layout,screenshot})=>{
  await login(page,password);
  await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
  await step('名簿の3区分から複数演者を選択しテーマを保存',async()=>{
    await page.goto(`${base}/seminars/new`);
    await page.getByLabel('セミナー名',{exact:false}).fill('複数演者選択の検証');
    await page.getByLabel('開催回数',{exact:false}).selectOption('SINGLE');
    await page.locator('[data-form-section="演者・テーマ"] > summary').click();
    await expect(page.getByRole('heading',{name:'演者登録（複数名登録可）',exact:true})).toBeVisible();
    await expect(page.getByRole('group',{name:'名簿から演者を複数選択',exact:true})).toHaveCount(0);
    for(const [i,role] of ['EXTERNAL_LECTURER','EXTERNAL_LECTURER','SOCIETY_LECTURER','SOCIETY_LECTURER','SOCIETY_SUPPORT'].entries()){
      await page.getByRole('button',{name:'演者を追加',exact:true}).click();
      const card=page.getByRole('group',{name:`演者 ${i+1}`,exact:true});
      await card.getByLabel('演者区分',{exact:true}).selectOption(role);
      await expect(card.getByLabel('名簿から選択').locator('option')).not.toHaveCount(1);
      await card.getByLabel('名簿から選択').selectOption({index:role==='EXTERNAL_LECTURER'?i+1:role==='SOCIETY_LECTURER'?i-1:1});
      if(role==='EXTERNAL_LECTURER'){
        await card.getByLabel('お車代（円）',{exact:true}).fill(String((i+1)*1000));
        await card.getByLabel('謝礼（円）',{exact:true}).fill(String((i+1)*10000));
      }
    }
    const section=page.locator('[data-form-section="演者・テーマ"]');
    await expect(section.locator('textarea')).toHaveCount(5);
    for(let i=0;i<5;i++){const card=section.getByRole('group',{name:`演者 ${i+1}`,exact:true});if(!await card.locator('details').evaluate(el=>el.open))await card.locator('summary').click();await card.getByLabel('テーマ',{exact:true}).fill(`演者テーマ${i+1}`);}
    await layout('複数選択');await screenshot('speaker-selection');
    await page.getByRole('button',{name:'登録する',exact:true}).click();await page.waitForURL(/\/seminars\/\d+$/);
  });
  const id=new URL(page.url()).pathname.split('/').pop();
  const saved=await (await page.request.get(`${base}/api/seminars/${id}`)).json();assert.equal(saved.speakers.length,5);assert.deepEqual(saved.speakers.slice(0,2).map(p=>p.payment),[{travel:1000,honorarium:10000},{travel:2000,honorarium:20000}]);assert.deepEqual(saved.external_payment,{travel:3000,honorarium:30000});
  const finance=await (await page.request.get(`${base}/api/seminars/${id}/finance`)).json();assert.equal(finance.estimate.travel,3000);assert.equal(finance.estimate.honorarium,30000);
  await step('再編集で演者とテーマを保持し選択解除を反映',async()=>{
    await page.goto(`${base}/seminars/${id}/edit`);
    await page.locator('[data-form-section="演者・テーマ"] > summary').click();
    const section=page.locator('[data-form-section="演者・テーマ"]');
    await expect(section.locator('textarea').nth(4)).toHaveValue('演者テーマ5');
    await expect(page.getByRole('heading',{name:'演者登録（複数名登録可）',exact:true})).toBeVisible();
    const first=page.getByRole('group',{name:'演者 1',exact:true}),second=page.getByRole('group',{name:'演者 2',exact:true});
    await expect(first.getByLabel('お車代（円）',{exact:true})).toHaveValue('1000');
    await expect(second.getByLabel('謝礼（円）',{exact:true})).toHaveValue('20000');
    await first.locator('summary').click();
    await first.getByRole('button',{name:'演者 1 を削除',exact:true}).click();await expect(section.locator('textarea')).toHaveCount(4);
    await page.getByRole('button',{name:'変更を保存',exact:true}).click();await page.waitForURL(/\/seminars\/\d+$/);
    const updated=await (await page.request.get(`${base}/api/seminars/${id}`)).json();assert.equal(updated.speakers.length,4);assert.equal(updated.speakers[0].theme,'演者テーマ2');assert.deepEqual(updated.external_payment,{travel:2000,honorarium:20000});
  });
  await step('保存済みメールを最新タスクの依頼文から再生成し明示保存',async()=>{
    const list=await (await page.request.get(`${base}/api/seminars/${id}/tasks`)).json();const task=list.tasks[0];
    const endpoint=`${base}/api/seminars/${id}/tasks/${task.id}/mail`;
    let result=await (await page.request.get(endpoint)).json();
    assert.ok((await page.request.patch(endpoint,{headers:{Origin:base},data:{to:'teacher@example.invalid',subject:'保存した件名',body:'以前の依頼状',version:0}})).ok());
    assert.ok((await page.request.patch(`${base}/api/seminars/${id}/tasks/${task.id}`,{headers:{Origin:base},data:{description:'最新版の個別タスク依頼状です。',version:task.version}})).ok());
    await page.goto(`${base}/seminars/${id}/email-templates`);
    await page.getByRole('button',{name:'文面を確認',exact:true}).first().click();
    const body=page.getByLabel('メールの本文',{exact:true});await expect(body).toHaveValue('以前の依頼状');
    page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'タスクの依頼文から作り直す',exact:true}).click();
    await expect(body).toHaveValue(/最新版の個別タスク依頼状です。/);
    await expect(page.getByLabel('メールの宛先',{exact:true})).toHaveValue('teacher@example.invalid');
    result=await (await page.request.get(endpoint)).json();assert.equal(result.mail.body,'以前の依頼状');
    await page.getByRole('button',{name:'文面を保存',exact:true}).click();await expect(page.getByRole('status')).toContainText('文面を保存しました');
    result=await (await page.request.get(endpoint)).json();assert.ok(result.mail.body.includes('最新版の個別タスク依頼状です。'));
    await layout('最新依頼状');await screenshot('latest-task-mail');
  });
});
