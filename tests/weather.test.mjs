import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { inWeatherWindow, weatherDescription } from '../types/weather.ts';
import { todayInTokyo } from '../types/task.ts';
import { addressPrefecture, resolveForecastLocation, parseJmaForecast, createJmaClient, eventWeather } from '../lib/weather.ts';
import { areas, forecastFixture, offset } from './fixtures/weather-jma.mjs';
const now = new Date('2026-11-09T03:00:00Z'), today = todayInTokyo(now), clone = p => structuredClone(p);
const location = resolveForecastLocation('会場 / 東京都新宿区架空1-1', areas);
const event = (id = 1, dates = [today], extra = {}) => ({ id, dates, venue: '会場 / 東京都新宿区架空1-1', delivery_method: 'ONSITE', session_delivery_methods: {}, ...extra });

test('weather window uses Japanese calendar days, starts exactly seven days before each date and ends after the event day', () => {
  assert.equal(todayInTokyo(new Date('2026-11-08T15:00:00Z')), today);
  for (const n of [0, 1, 6, 7]) assert.ok(inWeatherWindow(offset(today, n), today));
  for (const n of [-1, 8, 30]) assert.ok(!inWeatherWindow(offset(today, n), today));
  assert.ok(!inWeatherWindow('2026-02-30', '2026-02-28')); assert.ok(!inWeatherWindow('bad', today));
  assert.ok(inWeatherWindow('2028-02-29', '2028-02-22'));
});

test('weather locations require a unique prefecture and city and follow the JMA region hierarchy, including Hokkaido and islands', () => {
  assert.equal(location.office, '130000'); assert.equal(location.code, '130010'); assert.equal(location.city, '新宿区');
  assert.equal(resolveForecastLocation('神奈川県横浜市架空', areas).office, '140000');
  assert.equal(resolveForecastLocation('北海道札幌市架空', areas).office, '016000');
  assert.equal(resolveForecastLocation('東京都小笠原村架空', areas).code, '130040');
  for (const address of ['', '会議室', '東京都', '架空県新宿区', '東京都新宿区／神奈川県横浜市', '東京都架空市']) assert.equal(resolveForecastLocation(address, areas), null);
  assert.equal(addressPrefecture('東京都 新宿区').code, '13');
  const ambiguous = clone(areas); ambiguous.class20s.other = { name: '新宿区', parent: '130041' };
  assert.equal(resolveForecastLocation('東京都新宿区', ambiguous), null);
  assert.equal(resolveForecastLocation('東京都新宿区', { offices: {} }), null);
});

test('short-term forecasts override weekly weather and temperatures; 0 and negative temperatures are preserved', () => {
  const fixture = forecastFixture(), first = parseJmaForecast(fixture, location, 1, today, now);
  assert.equal(first.label, '晴れ'); assert.equal(first.max, 0); assert.equal(first.min, -2); assert.equal(first.state, 'READY');
  assert.equal(first.region, '東京地方'); assert.equal(first.station, '東京'); assert.ok(first.source_url.includes('area_code=130000'));
  const tomorrow = parseJmaForecast(fixture, location, 1, offset(today, 1), now);
  assert.equal(tomorrow.label, 'くもり'); assert.equal(tomorrow.max, 20); assert.equal(tomorrow.min, 10);
  const weekly = parseJmaForecast(fixture, location, 1, offset(today, 7), now);
  assert.equal(weekly.label, '大雨'); assert.equal(weekly.severe, true); assert.equal(weekly.max, 27); assert.equal(weekly.min, -3);
  assert.equal(weatherDescription('308').label, '暴風雨'); assert.equal(weatherDescription('405').icon, '🌨️');
});

test('unpublished or malformed values never turn into invented weather or zero-degree temperatures, and stale reports are rejected', () => {
  const fixture = forecastFixture(); fixture[1].timeSeries[1].areas[0].tempsMin[6] = ''; fixture[1].timeSeries[1].areas[0].tempsMax[6] = '999';
  fixture[1].timeSeries[0].areas[0].weatherCodes[6] = '999';
  const missing = parseJmaForecast(fixture, location, 1, offset(today, 7), now);
  assert.equal(missing.state, 'UNPUBLISHED'); assert.equal(missing.max, null); assert.equal(missing.min, null); assert.equal(missing.label, null);
  for (const value of [null, {}, [], [{ reportDatetime: 'bad', timeSeries: [] }], forecastFixture('2026-11-01')]) assert.equal(parseJmaForecast(value, location, 1, today, now).state, 'UNAVAILABLE');
  const partial = forecastFixture(); partial[0].timeSeries[1].areas[0].temps[2] = '';
  assert.equal(parseJmaForecast(partial, location, 1, offset(today, 1), now).min, 11);
  const otherStation = forecastFixture(); otherStation[1].timeSeries[1].areas[0].area.name = '離れた地点';
  assert.equal(parseJmaForecast(otherStation, location, 1, offset(today, 1), now).min, 10);
});

test('dates not present in a response and ambiguous regions do not borrow another day or region, while temperature stations are identified', () => {
  assert.equal(parseJmaForecast(forecastFixture(), location, 1, offset(today, 8), now).state, 'UNPUBLISHED');
  const fixture = forecastFixture(); fixture[1].timeSeries[0].areas.push({ area: { name: '別地域', code: '130040' }, weatherCodes: ['100', '100', '100', '100', '100', '100', '100'] });
  const island = { ...location, code: '130040', city: '小笠原村', primary: false };
  const data = parseJmaForecast(fixture, island, 1, offset(today, 7), now);
  assert.equal(data.label, '晴れ'); assert.equal(data.region, '別地域'); assert.equal(data.station, '東京');
  const unmatched = parseJmaForecast(fixture, { ...island, code: '130020' }, 1, offset(today, 7), now);
  assert.equal(unmatched.label, null);
});

test('event forecasts independently filter repeated dates, online-only sessions, past/undated events and addresses without locations', async () => {
  const urls = [], client = createJmaClient(async url => { urls.push(String(url)); return Response.json(String(url).endsWith('area.json') ? areas : forecastFixture()); }, () => now);
  const events = [event(1, [today, today, offset(today, 1), offset(today, 7), offset(today, 8), offset(today, -1)], { session_delivery_methods: { [offset(today, 1)]: 'ONLINE' } }),
    event(2, [today], { delivery_method: 'ONLINE' }), event(3, []), event(4, [today], { venue: '未設定' }), event(5, [today], { delivery_method: 'HYBRID' })];
  const result = await eventWeather(events, client, now);
  assert.equal(result.as_of_date, today); assert.equal(result.forecasts.length, 4);
  assert.deepEqual(result.forecasts.filter(f => f.seminar_id === 1).map(f => f.date), [today, offset(today, 7)]);
  assert.equal(result.forecasts.find(f => f.seminar_id === 4).state, 'MISSING_LOCATION');
  assert.equal(urls.length, 2); assert.ok(urls.every(url => !url.includes('新宿') && !url.includes('会場')));
  const count = urls.length; assert.deepEqual((await eventWeather([event(8, [offset(today, 8)]), event(9, [], {})], client, now)).forecasts, []); assert.equal(urls.length, count);
});

test('forecast reads share in-flight requests and cache regions for 24 hours and forecasts for one hour', async () => {
  let clock = now, count = 0;
  const client = createJmaClient(async url => { count++; return Response.json(String(url).endsWith('area.json') ? areas : forecastFixture()); }, () => clock);
  await Promise.all([eventWeather([event()], client, clock), eventWeather([event(2)], client, clock)]); assert.equal(count, 2);
  await eventWeather([event()], client, clock); assert.equal(count, 2);
  clock = new Date(clock.getTime() + 3600000); await eventWeather([event()], client, clock); assert.equal(count, 3);
  clock = new Date(now.getTime() + 24 * 3600000); await eventWeather([event(1, [offset(today, 7)])], client, clock); assert.equal(count, 5);
});

test('provider failures are isolated from event data, negatively cached for five minutes, and malformed location metadata is an outage', async () => {
  let clock = now, count = 0;
  const client = createJmaClient(async () => { count++; throw new Error('network unavailable'); }, () => clock);
  let result = await eventWeather([event(), event(2, [today], { venue: '' })], client, clock);
  assert.equal(result.forecasts[0].state, 'UNAVAILABLE'); assert.equal(result.forecasts[1].state, 'MISSING_LOCATION'); assert.equal(count, 1);
  await eventWeather([event()], client, clock); assert.equal(count, 1);
  clock = new Date(clock.getTime() + 5 * 60000); await eventWeather([event()], client, clock); assert.equal(count, 2);
  await assert.rejects(client.forecast('../../outside')); assert.equal(count, 2);
  const bad = createJmaClient(async () => Response.json({}), () => now);
  result = await eventWeather([event()], bad, now); assert.equal(result.forecasts[0].state, 'UNAVAILABLE');
  const malformed = createJmaClient(async () => new Response('not json'), () => now);
  assert.equal((await eventWeather([event()], malformed, now)).forecasts[0].state, 'UNAVAILABLE');
  const huge = createJmaClient(async () => new Response('x'.repeat(600000)), () => now); await assert.rejects(huge.forecast('130000'), /too large/);
});

test('upstream forecast concurrency is limited and a failed response does not leak an internal error', async () => {
  let running = 0, maximum = 0; const release = [];
  const client = createJmaClient(async () => { running++; maximum = Math.max(maximum, running); await new Promise(resolve => release.push(resolve)); running--; return Response.json(forecastFixture()); }, () => now);
  const requests = Array.from({ length: 9 }, (_, i) => client.forecast(String(130000 + i)));
  await setImmediate(); assert.equal(maximum, 4);
  while (release.length || running) { const batch = release.splice(0); batch.forEach(done => done()); await setImmediate(); }
  await Promise.all(requests); assert.equal(maximum, 4);
  const failing = createJmaClient(async url => String(url).endsWith('area.json') ? Response.json(areas) : new Response('private diagnostic marker', { status: 500 }), () => now);
  assert.ok(!JSON.stringify(await eventWeather([event()], failing, now)).includes('private diagnostic marker'));
});
