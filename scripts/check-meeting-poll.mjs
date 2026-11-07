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


for(const [name,viewport] of [['meeting-poll-desktop',{width:1280,height:900}],['meeting-poll-mobile',{width:390,height:844}],['meeting-poll-narrow',{width:320,height:700}]])await harness(name,viewport,async({page,password,step,layout,screenshot})=>{
  await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
  const created=await page.request.post(`${base}/api/seminars`,{headers:{Origin:base},data:{name:'架空：運営会議の日程調整',event_type:'SEMINAR',occurrence_type:'SINGLE',dates:[]}});assert.equal(created.status(),201);const event=await created.json(),url=`${base}/api/seminars/${event.id}/meeting-poll`;
  let original,members;
  const poll=page.getByRole('region',{name:'打ち合わせの日程調整',exact:true});
  async function get(){const r=await page.request.get(url);assert.equal(r.status(),200);return r.json();}
  async function patch(data,mi,ci,response){const m=data.members[mi],c=data.candidates[ci],a=data.answers.find(a=>a.member_id===m.id&&a.candidate_id===c.id);return page.request.patch(url,{headers:{Origin:base},data:{member_id:m.id,member_version:m.version,candidate_id:c.id,revision:c.revision,version:a?.version??0,response}});}
  function group(ci){const c=original.candidates[ci];return poll.getByRole('group',{name:`${members[0].name} ${c.date} ${c.start}${c.end?`〜${c.end}`:''}の回答`,exact:true});}
  await page.goto(`${base}/seminars/${event.id}/meetings`);
  await step('候補日時を10分刻みで設定し名簿10名の表を表示',async()=>{
    await expect(poll).toBeVisible();await poll.getByLabel('日程調整の名前',{exact:true}).fill('企画運営ミーティング');
    for(let i=1;i<=3;i++){await poll.getByRole('button',{name:'＋ 候補日時を追加',exact:true}).click();await expect(poll.getByLabel(`候補${i}の開始時刻`,{exact:true})).toHaveValue('20:00');await expect(poll.getByLabel(`候補${i}の終了時刻`,{exact:true})).toHaveValue('22:00');await poll.getByLabel(`候補${i}の日付`,{exact:true}).fill(`2027-06-0${i}`);await poll.getByLabel(`候補${i}の開始時刻`,{exact:true}).selectOption('19:00');await poll.getByLabel(`候補${i}の終了時刻`,{exact:true}).selectOption('20:00');assert.equal(await poll.getByLabel(`候補${i}の開始時刻`,{exact:true}).locator('option[value="19:05"]').count(),0);}
    await poll.getByRole('button',{name:'候補日時を保存',exact:true}).click();await expect(poll.getByRole('status')).toContainText('候補日時を保存しました');original=await get();members=original.members;assert.equal(members.length,10);assert.equal(original.candidates.length,3);await expect(poll.locator('tbody tr')).toHaveCount(10);await expect(poll.getByRole('button',{name:'○ 参加可能',exact:true})).toHaveCount(0);await expect(poll.getByRole('region',{name:'有力な候補日時',exact:true})).toHaveCount(0);await layout('候補日時の表');
  });
  await step('各自の名前で○△×を回答し自動保存・再読込で保持',async()=>{
    await poll.getByLabel('回答する方のお名前',{exact:true}).selectOption(String(members[0].id));
    for(const [i,response] of ['○ 参加可能','△ 調整が必要','× 参加不可'].entries()){await group(i).getByRole('button',{name:response,exact:true}).click();await expect(poll.getByRole('status')).toContainText(`「${response}」で保存しました`);await expect(group(i).getByRole('button',{name:response,exact:true})).toHaveAttribute('aria-pressed','true');}
    const data=await get();assert.deepEqual(data.answers.map(a=>a.response),['YES','MAYBE','NO']);await expect(poll.getByRole('region',{name:'有力な候補日時',exact:true})).toHaveCount(0);await expect(poll.getByRole('columnheader').filter({hasText:'★ 有力候補'})).toHaveCount(1);await page.reload();await expect(poll.getByLabel('回答する方のお名前',{exact:true})).toHaveValue('');await expect(poll.getByRole('row',{name:`${members[0].name}の日程回答`,exact:true})).toContainText('○');await poll.getByLabel('回答する方のお名前',{exact:true}).selectOption(String(members[0].id));await layout('回答表');await screenshot('poll');
    const scroll=poll.getByRole('region',{name:'日程調整表（横スクロール可）',exact:true});await scroll.scrollIntoViewIfNeeded();const pageScroll=await page.evaluate(()=>scrollX);await scroll.evaluate(el=>{el.scrollLeft=el.scrollWidth;});assert.equal(await page.evaluate(()=>scrollX),pageScroll);await expect(poll.getByRole('row',{name:`${members[0].name}の日程回答`,exact:true}).getByRole('rowheader')).toBeInViewport();
  });
  await step('別メンバーの回答を保持し同一回答の競合を拒否',async()=>{
    const current=await get();assert.equal((await patch(current,1,0,'YES')).status(),200);
    await group(1).getByRole('button',{name:'○ 参加可能',exact:true}).click();await expect(poll.getByRole('status')).toContainText('保存しました');let d=await get();assert.equal(d.answers.filter(a=>a.response==='YES').length,3);await expect(poll.getByRole('columnheader').filter({hasText:'★ 有力候補'})).toHaveCount(1);
    assert.equal((await patch(d,0,0,'NO')).status(),200);await group(0).getByRole('button',{name:'△ 調整が必要',exact:true}).click();await expect(poll.getByRole('alert')).toContainText('この回答が別の操作で変更されています');assert.equal((await get()).answers.find(a=>a.member_id===members[0].id&&a.candidate_id===original.candidates[0].id).response,'NO');await poll.getByRole('button',{name:'最新の表を取得',exact:true}).click();await expect(group(0).getByRole('button',{name:'× 参加不可',exact:true})).toHaveAttribute('aria-pressed','true');await expect(poll.getByRole('columnheader').filter({hasText:'★ 有力候補'})).toHaveCount(2);
  });
  await step('候補を編集中の回答保存でも古い候補で上書きしない',async()=>{
    await poll.getByText('候補日時を設定・変更する',{exact:true}).click();await poll.getByLabel('日程調整の名前',{exact:true}).fill('未保存の候補編集');
    const d=await get();const changed=await page.request.put(url,{headers:{Origin:base},data:{title:'別の端末で候補を追加',version:d.version,candidates:[...d.candidates.map(({id,date,start,end})=>({id,date,start,end})),{date:'2027-06-04',start:'19:00',end:null}]}});assert.equal(changed.status(),200);
    await group(2).getByRole('button',{name:'△ 調整が必要',exact:true}).click();await expect(poll.getByRole('status')).toContainText('保存しました');await poll.getByRole('button',{name:'候補日時を保存',exact:true}).click();await expect(poll.getByRole('alert')).toContainText('候補日時が別の操作で変更されています');assert.equal((await get()).candidates.length,4);await expect(poll.getByLabel('日程調整の名前',{exact:true})).toHaveValue('未保存の候補編集');
    page.once('dialog',d=>d.accept());await poll.getByRole('button',{name:'最新の表を取得',exact:true}).click();await expect(poll.getByLabel('日程調整の名前',{exact:true})).toHaveValue('別の端末で候補を追加');await poll.getByText('候補日時を設定・変更する',{exact:true}).click();
  });
  await step('候補変更は確認後にその列だけリセットし不正APIを拒否',async()=>{
    await poll.getByText('候補日時を設定・変更する',{exact:true}).click();await poll.getByLabel('候補1の日付',{exact:true}).fill('2027-06-09');page.once('dialog',d=>d.dismiss());await poll.getByRole('button',{name:'候補日時を保存',exact:true}).click();assert.equal((await get()).candidates[0].date,'2027-06-01');page.once('dialog',d=>d.accept());await poll.getByRole('button',{name:'候補日時を保存',exact:true}).click();await expect(poll.getByRole('status')).toContainText('候補日時を保存しました');const data=await get();assert.equal(data.answers.length,2);assert(data.answers.every(a=>a.candidate_id!==original.candidates[0].id));
    assert.equal((await page.request.put(url,{headers:{Origin:base},data:{title:data.title,version:data.version,candidates:[{date:'2027-02-30',start:'19:00',end:null}]}})).status(),400);
    assert.equal((await page.request.put(url,{headers:{Origin:'https://elsewhere.invalid'},data:{}})).status(),403);
    const anon=await page.context().browser().newContext();try{assert.equal((await anon.request.get(url)).status(),401);}finally{await anon.close();}
    const failure=async route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'架空：保存エラー'})});await page.route('**/meeting-poll',route=>route.request().method()==='PUT'?failure(route):route.continue());await poll.getByLabel('日程調整の名前',{exact:true}).fill('保存失敗でも残す入力');await poll.getByRole('button',{name:'候補日時を保存',exact:true}).click();await expect(poll.getByRole('alert')).toContainText('架空：保存エラー');await expect(poll.getByLabel('日程調整の名前',{exact:true})).toHaveValue('保存失敗でも残す入力');await page.unroute('**/meeting-poll');await layout('候補の編集');await screenshot('poll-edit');
    await expect(page.getByRole('heading',{name:'打ち合わせの登録（確定した日程）',exact:true})).toBeVisible();
  });
});
