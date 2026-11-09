import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { chromium } from 'playwright';
import { expect } from 'playwright/test';
import { createAuthStore } from '../lib/auth.ts';
import { todayInTokyo } from '../types/task.ts';
import { areas, forecastFixture, offset } from '../tests/fixtures/weather-jma.mjs';

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
    const mockPath = join(directory, 'weather-mock.mjs');
    writeFileSync(join(directory, 'weather.json'), JSON.stringify({ areas, forecast: forecastFixture(todayInTokyo()) }));
    writeFileSync(mockPath, `import {readFileSync,appendFileSync} from 'node:fs';
      const original=globalThis.fetch,fixture=JSON.parse(readFileSync(new URL('./weather.json',import.meta.url),'utf8'));
      globalThis.fetch=async(input,options)=>{
        const target=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
        if(target.hostname==='www.jma.go.jp'){
          appendFileSync(new URL('./weather-calls.txt',import.meta.url),target.href+'\\n');
          if(target.pathname==='/bosai/common/const/area.json')return Response.json(fixture.areas);
          if(target.pathname==='/bosai/forecast/data/forecast/130000.json')return Response.json(fixture.forecast);
          return new Response('Fixture missing',{status:503});
        }
        if(['localhost','127.0.0.1'].includes(target.hostname))return original(input,options);
        throw new Error('External requests are blocked by the weather test');
      };`);
    server = spawn(process.execPath, ['--import', mockPath, 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '3200'], {
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
    await run({ page, context, db, password, step, screenshot, layout, directory });
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

for (const [name, viewport] of [['weather-desktop', { width: 1280, height: 900 }], ['weather-mobile', { width: 390, height: 844 }], ['weather-narrow', { width: 320, height: 700 }]]) await harness(name, viewport, async ({ page, password, step, screenshot, layout, directory }) => {
  const origin = { Origin: base }, today = todayInTokyo();
  const anonymous = await page.request.get(base + '/api/weather'); assert.equal(anonymous.status(), 401); assert.equal(anonymous.headers()['cache-control'], 'no-store');
  await login(page, password); await expect(page.getByRole('heading', { name: 'イベント一覧', exact: true })).toBeVisible();
  const create = async input => {
    const response = await page.request.post(base + '/api/seminars', { headers: origin, data: input });
    assert.equal(response.status(), 201); return response.json();
  };
  const event = await create({ name: '架空：天気予報セミナー', event_type: 'BASIC_COURSE', occurrence_type: 'MULTIPLE', dates: [-1, 0, 1, 2, 5, 7, 8].map(n => offset(today, n)), venue: '架空会場 / 東京都新宿区架空1-1', delivery_method: 'ONSITE', session_delivery_methods: { [offset(today, 2)]: 'ONLINE' } });
  const rain = await create({ name: '架空：雨の日の講演会', event_type: 'LECTURE', occurrence_type: 'SINGLE', dates: [offset(today, 3)], venue: '架空会場 / 東京都新宿区架空1-1', delivery_method: 'HYBRID' });
  const online = await create({ name: '架空：オンライン', event_type: 'OTHER', occurrence_type: 'SINGLE', dates: [offset(today, 7)], delivery_method: 'ONLINE' });
  const missing = await create({ name: '架空：住所未設定', event_type: 'OTHER', occurrence_type: 'SINGLE', dates: [today], venue: '会議室', delivery_method: 'ONSITE' });
  const undated = await create({ name: '架空：日程未定', event_type: 'OTHER', occurrence_type: 'SINGLE', dates: [], venue: '東京都新宿区', delivery_method: 'ONSITE' });
  const weather = (id, date) => page.locator(`[data-event-weather="${id}:${date}"]`);
  await step('実API経由でJMA形式の予報を解析し、日別の対象と認証・キャッシュを確認する', async () => {
    const response = await page.request.get(base + '/api/weather'); assert.equal(response.status(), 200); assert.equal(response.headers()['cache-control'], 'no-store');
    const data = await response.json(); assert.equal(data.as_of_date, today); assert.equal(data.forecasts.length, 6);
    const first = data.forecasts.find(f => f.seminar_id === event.id && f.date === today); assert.equal(first.label, '晴れ'); assert.equal(first.max, 0); assert.equal(first.min, -2);
    assert.ok(!data.forecasts.some(f => f.date === offset(today, -1) || f.date === offset(today, 8) || f.seminar_id === online.id || f.seminar_id === undated.id));
    assert.equal(data.forecasts.find(f => f.seminar_id === missing.id).state, 'MISSING_LOCATION');
    await page.request.get(base + '/api/weather');
    const calls = readFileSync(join(directory, 'weather-calls.txt'), 'utf8').trim().split('\n');
    assert.deepEqual(calls.sort(), ['https://www.jma.go.jp/bosai/common/const/area.json', 'https://www.jma.go.jp/bosai/forecast/data/forecast/130000.json'].sort());
  });
  await step('HOMEとカード一覧で晴れ・曇り・雨・大雨と最高最低気温を表示する', async () => {
    await page.goto(base + '/home');
    await expect(weather(event.id, today)).toContainText('晴れ'); await expect(weather(event.id, today)).toContainText('最高 0℃'); await expect(weather(event.id, today)).toContainText('最低 -2℃');
    await expect(weather(event.id, offset(today, 1))).toContainText('くもり'); await expect(weather(event.id, offset(today, 7))).toContainText('大雨');
    await expect(weather(rain.id, offset(today, 3))).toContainText('雨');
    for (const date of [offset(today, -1), offset(today, 2), offset(today, 8)]) await expect(weather(event.id, date)).toHaveCount(0);
    await expect(weather(online.id, offset(today, 7))).toHaveCount(0); await expect(weather(missing.id, today)).toContainText('都道府県・市区町村');
    await expect(page.getByRole('link', { name: '気象庁の天気予報', exact: true })).toHaveCount(1);
    await expect(weather(event.id, today)).toContainText('予報地域：東京地方'); await expect(weather(event.id, today)).toContainText('気温：東京');
    await expect(page.locator('a a')).toHaveCount(0); await layout('HOMEの天気予報'); await screenshot('weather-cards');
  });
  await step('行表示でも当日の予報を表示し、画面幅からはみ出さない', async () => {
    await page.getByRole('button', { name: 'シンプルな行表示', exact: true }).click();
    await expect(page.getByRole('table', { name: '予定の行一覧', exact: true })).toBeVisible();
    await expect(weather(event.id, today)).toContainText('最高 0℃'); await expect(weather(event.id, offset(today, 7))).toContainText('最低 -3℃');
    await layout('予報付き行一覧'); await screenshot('weather-rows');
  });
  await step('イベント詳細で各開催日の地域と予報地点、発表日時を確認する', async () => {
    await page.goto(base + `/seminars/${event.id}`);
    await expect(page.getByRole('region', { name: '開催日の天気予報', exact: true })).toBeVisible();
    await expect(page.locator('[data-event-weather]')).toHaveCount(4);
    await expect(weather(event.id, offset(today, 7))).toContainText(`${offset(today, 7)}の天気`);
    await expect(weather(event.id, offset(today, 7))).toContainText('大雨'); await expect(weather(event.id, offset(today, 7))).toContainText('発表');
    await layout('詳細の天気予報'); await screenshot('weather-detail');
  });
  await step('取得エラーや気温未発表でもイベント内容を表示し、0℃を捏造しない', async () => {
    await page.route('**/api/weather', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: '架空の取得エラー' }) }));
    await page.reload(); await expect(page.getByRole('heading', { name: event.name, exact: true })).toBeVisible();
    await expect(weather(event.id, today)).toContainText('取得できません');
    await page.unroute('**/api/weather');
    await page.route('**/api/weather', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ as_of_date: today, forecasts: [{ seminar_id: event.id, date: today, state: 'UNPUBLISHED', label: null, icon: '', severe: false, max: null, min: null, region: null, station: null, issued_at: null, source_url: null }] }) }));
    await page.reload(); await expect(weather(event.id, today)).toContainText('予報未発表');
    await expect(weather(event.id, today)).toContainText('最高 未発表'); await expect(weather(event.id, today)).toContainText('最低 未発表'); await expect(weather(event.id, today)).not.toContainText('0℃');
    await page.unroute('**/api/weather');
  });
  await step('開いたまま日付が変わると表示対象を更新し、前日の予報を残さない', async () => {
    await page.clock.install({ time: new Date(today + 'T23:59:30+09:00') }); await page.goto(base + '/home');
    await expect(weather(event.id, today)).toContainText('晴れ');
    const actual = await (await page.request.get(base + '/api/weather')).json();
    const entering = { ...actual.forecasts.find(f => f.seminar_id === event.id && f.date === offset(today, 7)), date: offset(today, 8), label: '晴れ', max: 28, min: 18 };
    await page.route('**/api/weather', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...actual, as_of_date: offset(today, 1), forecasts: [...actual.forecasts.filter(f => f.date >= offset(today, 1)), entering] }) }));
    await page.clock.fastForward(60000);
    await expect(weather(event.id, today)).toHaveCount(0); await expect(weather(event.id, offset(today, 7))).toContainText('大雨');
    await expect(weather(event.id, offset(today, 8))).toContainText('晴れ');
    await layout('日本時間の日付変更後');
  });
});
