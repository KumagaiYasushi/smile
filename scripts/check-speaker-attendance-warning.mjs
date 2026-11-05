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


for(const [name,viewport] of [['speaker-warning-desktop',{width:1280,height:900}],['speaker-warning-mobile',{width:390,height:844}]])await harness(name,viewport,async({page,password,step,layout,screenshot})=>{
  await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
  const directory=await (await page.request.get(`${base}/api/society-members`)).json(),lecturer=directory.members.find(p=>p.active&&p.role==='SOCIETY_LECTURER'),support=directory.members.find(p=>p.active&&p.role==='SOCIETY_SUPPORT'),dates=['2027-06-01','2027-06-08'];let id;
  async function confirmChange(action,accept,name){const waiting=page.waitForEvent('dialog');const clicking=action();const dialog=await waiting;assert.equal(dialog.type(),'confirm');assert.ok(dialog.message().includes('演者')&&dialog.message().includes(name));if(accept)await dialog.accept();else await dialog.dismiss();await clicking;}
  async function noWarning(action){let count=0;const handle=async dialog=>{count++;await dialog.dismiss();};page.on('dialog',handle);try{await action();assert.equal(count,0);}finally{page.off('dialog',handle);}}
  await step('新規登録中の演者は登壇日だけ欠席・午前のみ・午後のみで確認',async()=>{
    await page.goto(`${base}/seminars/new`);await page.getByLabel('セミナー名',{exact:false}).fill('演者の出欠警告');await page.getByLabel('開催回数',{exact:false}).selectOption('MULTIPLE');await page.getByLabel('開催日 1',{exact:true}).fill(dates[0]);await page.getByRole('button',{name:'＋ 日程を追加',exact:true}).click();await page.getByLabel('開催日 2',{exact:true}).fill(dates[1]);for(const date of dates)await page.getByLabel(`${date}の開催方法`).selectOption('ONSITE');
    await page.locator('[data-form-section="演者・テーマ"] > summary').click();
    for(const [i,person] of [lecturer,support].entries()){await page.getByRole('button',{name:`${dates[i]}に演者を追加`,exact:true}).click();const card=page.getByRole('group',{name:`演者 ${i+1}`,exact:true});await card.getByLabel('演者区分').selectOption(person.role);await expect(card.getByLabel('名簿から選択').locator(`option[value="${person.id}"]`)).toHaveCount(1);await card.getByLabel('名簿から選択').selectOption(String(person.id));await card.getByRole('button',{name:'入力を閉じる',exact:true}).click();}
    await page.locator('[data-form-section="イベント当日の出欠"] > summary').click();const board=page.getByRole('region',{name:'研究会名簿から出欠登録',exact:true}),group=board.getByRole('group',{name:`${lecturer.name}の出欠`,exact:true});
    await confirmChange(()=>group.getByRole('radio',{name:'欠席',exact:true}).click(),false,lecturer.name);await expect(group.getByRole('radio',{name:'未登録',exact:true})).toBeChecked();
    for(const label of ['午前のみ','午後のみ','欠席']){await confirmChange(()=>group.getByRole('radio',{name:label,exact:true}).click(),true,lecturer.name);await expect(group.getByRole('radio',{name:label,exact:true})).toBeChecked();}
    await noWarning(()=>group.getByRole('radio',{name:'出席',exact:true}).click());
    await board.getByLabel('出欠を登録する開催日').selectOption(dates[1]);await noWarning(()=>group.getByRole('radio',{name:'欠席',exact:true}).click());
    const other=board.getByRole('group',{name:`${support.name}の出欠`,exact:true});await confirmChange(()=>other.getByRole('radio',{name:'午前のみ',exact:true}).click(),false,support.name);await expect(other.getByRole('radio',{name:'未登録',exact:true})).toBeChecked();
    await page.getByRole('button',{name:'登録する',exact:true}).click();await page.waitForURL(/\/seminars\/\d+$/);id=new URL(page.url()).pathname.split('/').pop();
  });
  await step('登録後の出欠画面でも確認しキャンセル時は保存しない',async()=>{
    await page.goto(`${base}/seminars/${id}/staff-attendance`);const board=page.getByRole('region',{name:'研究会名簿から出欠登録',exact:true});await board.getByLabel('出欠を登録する開催日').selectOption(dates[1]);const group=board.getByRole('group',{name:`${support.name}の出欠`,exact:true});
    await confirmChange(()=>group.getByRole('radio',{name:'欠席',exact:true}).click(),false,support.name);await expect(group.getByRole('radio',{name:'未登録',exact:true})).toBeChecked();
    await confirmChange(()=>group.getByRole('radio',{name:'午後のみ',exact:true}).click(),true,support.name);await expect(group.getByRole('radio',{name:'午後のみ',exact:true})).toBeChecked();await expect(board.getByText(/午後のみを保存しました/)).toBeVisible();
    await page.reload();await board.getByLabel('出欠を登録する開催日').selectOption(dates[1]);await expect(group.getByRole('radio',{name:'午後のみ',exact:true})).toBeChecked();await layout('演者の出欠確認');await screenshot('warning-attendance');
  });
});
