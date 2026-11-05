import assert from 'node:assert/strict';
import {emptyRoleAssignments,emptyDayRoles} from '../types/event-roles.ts';
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



for(const [name,viewport] of [['timetable-desktop',{width:1280,height:900}],['timetable-mobile',{width:390,height:844}],['timetable-narrow',{width:320,height:700}],['timetable-tablet',{width:768,height:1024}]])await harness(name,viewport,async({page,password,step,layout,screenshot})=>{
  await login(page,password);await expect(page.getByRole('heading',{name:'イベント一覧',exact:true})).toBeVisible();
  const response=await page.request.post(`${base}/api/seminars`,{headers:{Origin:base},data:{name:'タイムスケジュール検証',occurrence_type:'MULTIPLE',dates:['2027-06-01','2027-06-08'],event_times:{'2027-06-01':{start:'09:00',end:'10:00'}},speakers:[{role:'EXTERNAL_LECTURER',id:null,name:'進行確認用の演者',facility:'検証施設',theme:'歯周基本治療',payment:{travel:1000,honorarium:20000}}]}});assert.equal(response.status(),201);
  const event=await response.json(),endpoint=`${base}/api/seminars/${event.id}/timetable`;
  async function openChairs(number){const details=page.getByRole('listitem',{name:`予定 ${number}`,exact:true}).locator('[data-lecture-details]');if(!await details.evaluate(el=>el.open))await details.locator('summary').click();}
  const rolesEndpoint=`${base}/api/seminars/${event.id}/roles`,rolesData=await (await page.request.get(rolesEndpoint)).json();
  const [chairA,chairB,chairC]=rolesData.members.filter(p=>p.active),person=p=>({member_id:p.id,member_version:p.version});
  const roleInput={version:rolesData.version,assignments:emptyRoleAssignments(),day_assignments:{'2027-06-01':{...emptyDayRoles(),CHAIR:[person(chairA),person(chairB)]},'2027-06-08':{...emptyDayRoles(),CHAIR:[person(chairC)]}}};
  assert.equal((await page.request.put(rolesEndpoint,{headers:{Origin:base},data:roleInput})).status(),200);

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
    const lecture=page.getByRole('listitem',{name:'予定 3',exact:true}),chairs=lecture.getByRole('group',{name:'この講演の座長（複数選択可）',exact:true});
    await openChairs(3);await chairs.getByRole('checkbox',{name:chairA.name,exact:true}).check();await chairs.getByRole('checkbox',{name:chairB.name,exact:true}).check();
    await expect(chairs.getByRole('checkbox',{name:chairC.name,exact:true})).toHaveCount(0);
    await expect(page.getByRole('listitem',{name:'予定 1',exact:true}).getByRole('group',{name:'この講演の座長（複数選択可）',exact:true})).toHaveCount(0);
    await lecture.locator('[data-lecture-details] > summary').click();
    await layout('初期スケジュール');
  });
  await step('並べ替えと所要時間変更で時刻を再計算し重複項目を追加',async()=>{
    const from=page.getByRole('button',{name:'予定 3をドラッグして移動',exact:true}),target=page.getByRole('listitem',{name:'予定 2',exact:true});
    await target.evaluate(el=>el.scrollIntoView({block:'center',behavior:'instant'}));
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
    await openChairs(2);await expect(page.getByRole('listitem',{name:'予定 2',exact:true}).getByRole('checkbox',{name:chairA.name,exact:true})).toBeChecked();
    const duration=page.getByRole('listitem',{name:'予定 2',exact:true}).getByLabel('所要時間（分）',{exact:true});await duration.fill('');await expect(duration).toHaveValue('');await duration.pressSequentially('50');await expect(duration).toHaveValue('50');
    const editedTitle=page.getByRole('listitem',{name:'予定 2',exact:true}).getByLabel('項目名',{exact:true});await editedTitle.fill('変更後の講演タイトル');
    await expect(page.getByText('基本情報の終了時刻を5分超過',{exact:true})).toBeVisible();
    await expect(page.getByRole('listitem',{name:'予定 3',exact:true})).toContainText('09:55〜10:05');
    const chooser=page.getByRole('group',{name:'追加する項目（複数選択可）',exact:true});await chooser.getByLabel('項目を選択',{exact:true}).selectOption({label:'休憩'});await page.getByRole('button',{name:'選択した項目を追加',exact:true}).click();
    await expect(page.getByRole('listitem',{name:'予定 4',exact:true})).toContainText('10:05〜10:15');
    await page.getByRole('listitem',{name:'予定 4',exact:true}).getByRole('button',{name:'削除',exact:true}).click();
    await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('status')).toContainText('タイムスケジュールを保存しました');
    const saved=await (await page.request.get(endpoint)).json();assert.deepEqual(saved.days[0].items.map(p=>p.type),['OPENING','LECTURE','BREAK']);assert.equal(saved.days[0].items[1].minutes,50);assert.equal(saved.days[0].items[1].title,'変更後の講演タイトル');assert.ok(!JSON.stringify(saved).includes('honorarium'));
    assert.deepEqual(saved.days[0].items[1].chairs.map(p=>p.member_id),[chairA.id,chairB.id]);
    await screenshot('timetable');
  });
  await step('日別の保持・再取得・競合と保存失敗時の入力保持',async()=>{
    await page.reload();await expect(page.getByRole('listitem',{name:'予定 2',exact:true})).toContainText('09:05〜09:55');await expect(page.getByRole('listitem',{name:'予定 2',exact:true}).getByLabel('項目名',{exact:true})).toHaveValue('変更後の講演タイトル');
    await page.getByLabel('対象の日程',{exact:true}).selectOption('1');await expect(page.getByRole('listitem',{name:'予定 1',exact:true})).toHaveCount(0);
    await page.getByLabel('対象の日程',{exact:true}).selectOption('0');
    await openChairs(2);await expect(page.getByRole('listitem',{name:'予定 2',exact:true}).getByRole('checkbox',{name:chairB.name,exact:true})).toBeChecked();
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
    const secondDayLecture=page.getByRole('listitem',{name:'予定 7',exact:true});await openChairs(7);await openChairs(8);
    await expect(secondDayLecture.getByRole('checkbox',{name:chairA.name,exact:true})).toHaveCount(0);
    await secondDayLecture.getByRole('checkbox',{name:chairC.name,exact:true}).check();
    await expect(page.getByRole('listitem',{name:'予定 8',exact:true}).getByRole('checkbox',{name:chairC.name,exact:true})).not.toBeChecked();

    const first=page.getByRole('listitem',{name:'予定 1',exact:true});assert.equal(await first.evaluate(el=>getComputedStyle(el).backgroundColor),colors[0]);assert.equal(await page.getByRole('listitem',{name:'予定 2',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),colors[0]);assert.equal(await page.getByRole('listitem',{name:'予定 4',exact:true}).evaluate(el=>getComputedStyle(el).backgroundColor),colors[2]);await first.getByLabel('項目名',{exact:true}).fill('昼休憩・前半');
    await expect(page.getByRole('listitem',{name:'予定 2',exact:true}).getByLabel('項目名',{exact:true})).toHaveValue('昼休憩');
    await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('status')).toContainText('保存しました');
    const saved=await (await page.request.get(endpoint)).json(),items=saved.days.find(p=>p.date==='2027-06-08').items;
    assert.equal(items.length,8);assert.equal(new Set(items.map(p=>p.id)).size,8);assert.deepEqual(['LUNCH_BREAK','DISCUSSION','GROUP_DISCUSSION','LECTURE'].map(type=>items.filter(p=>p.type===type).length),[2,1,3,2]);
    await page.reload();await page.getByLabel('対象の日程',{exact:true}).selectOption('1');await expect(page.getByRole('listitem',{name:'予定 1',exact:true}).getByLabel('項目名',{exact:true})).toHaveValue('昼休憩・前半');
    await layout('個数指定');await screenshot('quantities');
    await openChairs(7);await expect(page.getByRole('listitem',{name:'予定 7',exact:true}).getByRole('checkbox',{name:chairC.name,exact:true})).toBeChecked();

  });

  await step('役割変更後の担当表示・解除と通常講演への座長登録',async()=>{
    await page.getByRole('group',{name:'追加する項目（複数選択可）',exact:true}).getByLabel('項目を選択',{exact:true}).selectOption('LECTURE');
    await page.getByRole('button',{name:'選択した項目を追加',exact:true}).click();
    await openChairs(9);await page.getByRole('listitem',{name:'予定 9',exact:true}).getByRole('checkbox',{name:chairC.name,exact:true}).check();
    await page.route(endpoint,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'検証用の保存失敗'})}),{times:1});
    await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'検証用の保存失敗'})).toBeVisible();
    await expect(page.getByRole('listitem',{name:'予定 9',exact:true}).getByRole('checkbox',{name:chairC.name,exact:true})).toBeChecked();
    await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('status')).toContainText('保存しました');
    const latestRoles=await (await page.request.get(rolesEndpoint)).json();roleInput.version=latestRoles.version;roleInput.day_assignments['2027-06-08'].CHAIR=[];
    assert.equal((await page.request.put(rolesEndpoint,{headers:{Origin:base},data:roleInput})).status(),200);
    await page.reload();await page.getByLabel('対象の日程',{exact:true}).selectOption('1');
    const lecture=page.getByRole('listitem',{name:'予定 9',exact:true}),assigned=lecture.getByRole('checkbox',{name:`${chairC.name}（当日役割・出欠が変更されています。担当を確認してください）`,exact:true});
    await openChairs(9);await expect(assigned).toBeChecked();await expect(lecture).toContainText('選択できる座長がいません');
    await assigned.click();await expect(assigned).toHaveCount(0);
    await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('status')).toContainText('保存しました');
    const saved=await (await page.request.get(endpoint)).json();assert.equal(saved.days.find(p=>p.date==='2027-06-08').items[8].chairs.length,0);
    assert.equal(saved.days.find(p=>p.date==='2027-06-01').items[1].chairs.length,2);
    await layout('講演ごとの座長');await screenshot('chairs');
  });

  await step('実習・講義・症例検討会を追加し横長の項目で編集・移動・保存',async()=>{
    await page.getByLabel('対象の日程',{exact:true}).selectOption('0');
    const chooser=page.getByRole('group',{name:'追加する項目（複数選択可）',exact:true}),labels=['実習(個人)','実習(相互)','講義','症例検討会'];
    for(const label of labels){await chooser.getByLabel('項目を選択').selectOption({label});await expect(chooser.getByLabel(`${label}の所要時間（分）`)).toHaveValue('30');}
    await chooser.getByLabel('実習(個人)の追加する数').fill('2');await page.getByRole('button',{name:'選択した項目を追加',exact:true}).click();
    await expect(page.getByRole('listitem',{name:'予定 8',exact:true})).toContainText('症例検討会');
    const first=page.getByRole('listitem',{name:'予定 4',exact:true}),title=first.getByLabel('項目名'),minutes=first.getByLabel('所要時間（分）');
    const box=await first.boundingBox(),a=await title.boundingBox(),b=await minutes.boundingBox();assert.ok(box.width>box.height*1.3,'項目が横長');assert.ok(Math.abs((a.y+a.height/2)-(b.y+b.height/2))<3&&a.x+a.width<=b.x+2,'項目名と所要時間は横並び');
    assert.ok(box.height<180,'スマートフォンでも項目の高さを抑える');await title.fill('実習(個人)・前半');await minutes.fill('');await expect(minutes).toHaveValue('');await minutes.fill('20');
    await first.getByRole('button',{name:'上へ',exact:true}).click();await expect(page.getByRole('listitem',{name:'予定 3',exact:true}).getByLabel('項目名')).toHaveValue('実習(個人)・前半');
    await page.getByRole('button',{name:'タイムスケジュールを保存',exact:true}).click();await expect(page.getByRole('status')).toContainText('保存しました');
    const saved=await (await page.request.get(endpoint)).json(),items=saved.days.find(p=>p.date==='2027-06-01').items;assert.equal(items.filter(p=>p.type==='PRACTICE_INDIVIDUAL').length,2);for(const type of ['PRACTICE_PAIR','CLASSROOM_LECTURE','CASE_REVIEW'])assert.equal(items.filter(p=>p.type===type).length,1);assert.equal(items[2].minutes,20);
    await page.reload();await expect(page.getByRole('listitem',{name:'予定 3',exact:true}).getByLabel('項目名')).toHaveValue('実習(個人)・前半');
    await expect(page.locator('[data-lecture-details][open]')).toHaveCount(0);await layout('横長のタイムスケジュール');await screenshot('compact-new-items');
  });

});
