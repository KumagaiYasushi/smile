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





for(const [name,viewport] of [['role-absence-desktop',{width:1280,height:900}],['role-absence-mobile',{width:390,height:844}]])await harness(name,viewport,async({page,password,step,layout,screenshot})=>{
  await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
  const members=(await (await page.request.get(`${base}/api/society-members`)).json()).members,member=members.find(p=>p.active&&p.role==='SOCIETY_LECTURER');
  const dates=['2027-06-01','2027-06-08'];
  await page.goto(`${base}/seminars/new`);await page.waitForFunction(()=>{const form=document.querySelector('form[data-stable-editor]');return form&&Object.keys(form).some(key=>key.startsWith('__reactProps$'));});await page.locator('details[data-form-section]').evaluateAll(sections=>sections.forEach(section=>{section.open=true;}));
  await page.getByLabel('セミナー名',{exact:false}).fill('欠席日の当日役割確認');await page.getByLabel('開催回数',{exact:false}).selectOption('MULTIPLE');
  await page.getByLabel('開催日 1',{exact:true}).fill(dates[0]);await page.getByRole('button',{name:'＋ 日程を追加',exact:true}).click();await page.getByLabel('開催日 2',{exact:true}).fill(dates[1]);
  for(const date of dates)await page.getByLabel(`${date}の開催方法`,{exact:true}).selectOption('ONSITE');
  const board=page.getByRole('region',{name:'研究会名簿から出欠登録',exact:true}),person=board.getByRole('group',{name:`${member.name}の出欠`,exact:true}),roleDate=page.getByLabel('当日役割の開催日',{exact:true});
  async function checkbox(role){const field=page.getByRole('group',{name:`${role}の担当者（複数選択可）`,includeHidden:true});await field.locator('..').evaluate(el=>{el.open=true;});return field.getByRole('checkbox',{name:`${member.name}を担当者に選択`,exact:true});}
  await step('欠席にした日だけをグレー表示し準備役割は選べる',async()=>{
    await person.getByRole('radio',{name:'欠席',exact:true}).click();const reception=await checkbox('受付');await expect(reception).toBeDisabled();await expect(reception.locator('..')).toHaveClass(/bg-slate-100/);await expect(reception).not.toBeChecked();
    const venue=await checkbox('会場担当');await expect(venue).toBeEnabled();await venue.check();
    await board.getByLabel('出欠を登録する開催日',{exact:true}).selectOption(dates[1]);await expect(roleDate).toHaveValue(dates[1]);
    await person.getByRole('radio',{name:'出席',exact:true}).click();await expect(reception).toBeEnabled();await reception.check();
    await roleDate.selectOption(dates[0]);await expect(board.getByLabel('出欠を登録する開催日',{exact:true})).toHaveValue(dates[0]);await expect(reception).toBeDisabled();
    await person.getByRole('radio',{name:'出席',exact:true}).click();await expect(reception).toBeEnabled();await reception.check();
  });
  await step('担当選択後の欠席変更は当日分だけ解除し他の日を保持',async()=>{
    const reception=await checkbox('受付');await roleDate.selectOption(dates[1]);await expect(reception).toBeChecked();
    await person.getByRole('radio',{name:'欠席',exact:true}).click();await expect(reception).not.toBeChecked();await expect(reception).toBeDisabled();
    await roleDate.selectOption(dates[0]);await expect(reception).toBeChecked();await expect(reception).toBeEnabled();await expect(await checkbox('会場担当')).toBeChecked();
    await layout('日別の候補制限');await screenshot('absence-roles');
    await page.route(`${base}/api/seminars`,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'検証用の保存失敗'})}),{times:1});
    await page.getByRole('button',{name:'登録する',exact:true}).click();await expect(reception).toBeChecked();await roleDate.selectOption(dates[1]);await expect(reception).toBeDisabled();
    await page.getByRole('button',{name:'登録する',exact:true}).click();await page.waitForURL(/\/seminars\/\d+$/);
  });
  const id=new URL(page.url()).pathname.split('/').pop(),endpoint=`${base}/api/seminars/${id}/roles`;
  await step('日別の担当・出欠の保存とAPI側の割当拒否を確認',async()=>{
    const saved=await (await page.request.get(endpoint)).json();assert.ok(saved.day_assignments[dates[0]].RECEPTION.some(p=>p.member_id===member.id));assert.equal(saved.day_assignments[dates[1]].RECEPTION.length,0);assert.ok(saved.assignments.VENUE.some(p=>p.member_id===member.id));
    const simple=roles=>Object.fromEntries(Object.entries(roles).map(([key,list])=>[key,list.map(p=>({member_id:p.member_id,member_version:p.member_version}))]));
    const days=Object.fromEntries(Object.entries(saved.day_assignments).map(([date,roles])=>[date,simple(roles)]));days[dates[1]].MC=[{member_id:member.id,member_version:member.version}];
    const denied=await page.request.put(endpoint,{headers:{Origin:base},data:{version:saved.version,assignments:simple(saved.assignments),day_assignments:days}});assert.equal(denied.status(),400);assert.equal((await (await page.request.get(endpoint)).json()).version,saved.version);
    await page.goto(`${base}/seminars/${id}/roles`);await roleDate.selectOption(dates[1]);await expect(await checkbox('受付')).toBeDisabled();await roleDate.selectOption(dates[0]);await expect(await checkbox('受付')).toBeChecked();await layout('保存後の候補制限');
  });
});
