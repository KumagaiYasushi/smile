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
    await context.route('**/*', route=>{const url=new URL(route.request().url());if(url.hostname==='restaurant.example.invalid')return route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:'<h1>検証用のお店ページ</h1>'});return url.origin===base?route.continue():route.abort();});
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


for(const [name,viewport] of [['social-links-desktop',{width:1280,height:900}],['social-links-mobile',{width:390,height:844}]])await harness(name,viewport,async({page,password,step,layout,screenshot})=>{
  await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
  const website='https://restaurant.example.invalid/menu?x=1&y=2',map='https://maps.example.invalid/path?q=東京';
  const venue=`架空のお店\n公式：${website}\n地図：(${map})。\njavascript:alert(1)\n<img id="unsafe-venue" src="x">`;
  let id;
  await step('入力欄のURLをリンクとして表示し別タブで開く',async()=>{
    await page.goto(`${base}/seminars/new`);await page.getByLabel('セミナー名',{exact:false}).fill('懇親会URLの検証');await page.getByLabel('開催回数',{exact:false}).selectOption('SINGLE');
    await page.locator('[data-form-section="懇親会"] > summary').click();await page.getByLabel('懇親会の開催',{exact:true}).selectOption('HELD');
    await page.getByLabel('懇親会の場所・住所',{exact:true}).fill(venue);
    const preview=page.getByRole('link',{name:'お店・場所のURLを開く',exact:true});await expect(preview).toHaveAttribute('href',website);await expect(preview).toHaveAttribute('target','_blank');
    await expect(page.getByRole('link',{name:'お店・場所のURLを開く（2）',exact:true})).toHaveAttribute('href',new URL(map).href);
    const popupPromise=page.waitForEvent('popup');await preview.click();const popup=await popupPromise;await expect(popup.getByRole('heading',{name:'検証用のお店ページ'})).toBeVisible();await popup.close();
    await layout('URL入力');await screenshot('url-editor');
    await page.getByRole('button',{name:'登録する',exact:true}).click();await page.waitForURL(/\/seminars\/\d+$/);id=new URL(page.url()).pathname.split('/').pop();
  });
  await step('保存後もお店情報の文章・改行を保ちURLだけリンクにする',async()=>{
    const details=page.locator('dd').filter({hasText:'架空のお店'});await expect(details).toHaveText(venue);await expect(details.getByRole('link')).toHaveCount(2);
    await expect(details.getByRole('link',{name:website,exact:true})).toHaveAttribute('href',website);await expect(details.getByRole('link',{name:map,exact:true})).toHaveAttribute('href',new URL(map).href);
    await expect(details.locator('a[href^="javascript:"]')).toHaveCount(0);await expect(page.locator('#unsafe-venue')).toHaveCount(0);
    await page.reload();await expect(details.getByRole('link')).toHaveCount(2);await layout('保存後のURL');await screenshot('url-details');
    await page.goto(`${base}/seminars/${id}/edit`);await page.locator('[data-form-section="懇親会"] > summary').click();await expect(page.getByLabel('懇親会の場所・住所')).toHaveValue(venue);await expect(page.getByRole('link',{name:'お店・場所のURLを開く',exact:true})).toHaveAttribute('href',website);
    await page.getByLabel('懇親会の場所・住所').fill('URLのないお店情報');await expect(page.getByRole('link',{name:'お店・場所のURLを開く',exact:true})).toHaveCount(0);
    await page.getByRole('button',{name:'変更を保存',exact:true}).click();await page.waitForURL(/\/seminars\/\d+$/);await expect(page.locator('dd').filter({hasText:'URLのないお店情報'})).toHaveText('URLのないお店情報');
  });
});
