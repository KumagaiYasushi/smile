import type { Seminar } from '../types/seminar.ts';
import { eventMethodForDate } from '../types/event-options.ts';
import { todayInTokyo } from '../types/task.ts';
import { inWeatherWindow, weatherDescription } from '../types/weather.ts';
import type { EventForecast, EventWeatherData } from '../types/weather.ts';

type Obj = Record<string, unknown>;
const obj = (p: unknown): Obj => p && typeof p === 'object' && !Array.isArray(p) ? p as Obj : {};
const list = (p: unknown): unknown[] => Array.isArray(p) ? p : [];
const text = (p: unknown): string => typeof p === 'string' ? p : '';
const normalize = (p: string) => p.normalize('NFKC').replace(/\s/g, '');
const PREFECTURES = ['北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県', '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'];
export type ForecastLocation = { office: string; code: string; name: string; city: string; primary: boolean };
export function addressPrefecture(address: string) {
  const found = PREFECTURES.map((name, i) => ({ name, code: String(i + 1).padStart(2, '0') })).filter(p => normalize(address).includes(p.name));
  return found.length === 1 ? found[0] : null;
}
export function resolveForecastLocation(address: string, value: unknown): ForecastLocation | null {
  const pref = addressPrefecture(address); if (!pref) return null;
  const input = normalize(address), areas = obj(value), offices = obj(areas.offices), regions = obj(areas.class10s), districts = obj(areas.class15s);
  const candidates = Object.values(obj(areas.class20s)).flatMap(raw => {
    const city = obj(raw), name = text(city.name), district = obj(districts[text(city.parent)]), code = text(district.parent);
    const region = obj(regions[code]), office = text(region.parent);
    if (name.length < 2 || !input.includes(normalize(name)) || !office.startsWith(pref.code) || !/^\d{6}$/.test(office) || !/^\d{6}$/.test(code) || !offices[office]) return [];
    return [{ office, code, name: text(region.name), city: name, primary: list(obj(offices[office]).children)[0] === code }];
  }).sort((a, b) => b.city.length - a.city.length);
  const best = candidates[0];
  if (!best || candidates.some(p => p.city.length === best.city.length && (p.office !== best.office || p.code !== best.code))) return null;
  return best;
}

function temperature(value: unknown): number | null {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value)) return null;
  const number = Number(value); return Number.isFinite(number) && number >= -100 && number <= 70 ? number : null;
}
function published(item: Obj, now: Date) {
  const stamp = text(item.reportDatetime), time = Date.parse(stamp);
  return Number.isFinite(time) && time <= now.getTime() + 15 * 60000 && time >= now.getTime() - 36 * 3600000 ? stamp : null;
}
export function emptyForecast(seminarId: number, date: string, state: EventForecast['state']): EventForecast {
  return { seminar_id: seminarId, date, state, label: null, icon: '', severe: false, max: null, min: null, region: null, station: null, issued_at: null, source_url: null };
}
export function parseJmaForecast(value: unknown, location: ForecastLocation, seminarId: number, date: string, now: Date): EventForecast {
  const result = emptyForecast(seminarId, date, 'UNPUBLISHED');
  result.source_url = `https://www.jma.go.jp/bosai/forecast/#area_type=offices&area_code=${location.office}`;
  let weatherPriority = -1, stationPriority = -1, maxPriority = -1, minPriority = -1, validReports = 0;
  for (const raw of list(value)) {
    const report = obj(raw), issued = published(report, now); if (!issued) continue; validReports++;
    for (const rawSeries of list(report.timeSeries)) {
      const series = obj(rawSeries), times = list(series.timeDefines).map(text), areas = list(series.areas).map(obj);
      const indexes = times.flatMap((time, i) => time.slice(0, 10) === date && /T\d{2}:\d{2}:\d{2}\+09:00$/.test(time) ? [i] : []);
      if (!indexes.length) continue;
      const weatherAreas = areas.filter(a => Array.isArray(a.weatherCodes) || Array.isArray(a.weathers));
      const weather = weatherAreas.find(a => obj(a.area).code === location.code) ?? (weatherAreas.length === 1 && !Array.isArray(weatherAreas[0].weathers) ? weatherAreas[0] : undefined);
      if (weather) {
        const priority = Array.isArray(weather.weathers) ? 2 : 1;
        const description = weatherDescription(list(weather.weatherCodes)[indexes[0]], list(weather.weathers)[indexes[0]]);
        if (description.label && priority >= weatherPriority) {
          Object.assign(result, description); result.region = text(obj(weather.area).name) || location.name;
          result.issued_at = issued; weatherPriority = priority;
        }
      }
      const tempAreas = areas.filter(a => Array.isArray(a.tempsMax) || Array.isArray(a.tempsMin) || Array.isArray(a.temps));
      const city = normalize(location.city).replace(/[市区町村]$/, '');
      const station = tempAreas.find(a => city.length > 1 && normalize(text(obj(a.area).name)).includes(city))
        ?? (tempAreas.length === 1 || location.primary ? tempAreas[0] : undefined);
      if (!station) continue;
      const weekly = Array.isArray(station.tempsMin) || Array.isArray(station.tempsMax), priority = weekly ? 1 : 2;
      let max: number | null = null, min: number | null = null;
      for (const index of indexes) {
        if (weekly) { max = temperature(list(station.tempsMax)[index]); min = temperature(list(station.tempsMin)[index]); }
        else {
          const hour = times[index].slice(11, 13);
          if (hour === '09') max = temperature(list(station.temps)[index]);
          if (hour === '00') min = temperature(list(station.temps)[index]);
        }
      }
      if (max !== null || min !== null) {
        // A different station must never supply the other half of a temperature pair.
        const name = text(obj(station.area).name);
        if (result.station && result.station !== name) {
          if (priority < stationPriority) continue;
          result.max = null; result.min = null; maxPriority = -1; minPriority = -1;
        }
        if (max !== null && priority >= maxPriority) { result.max = max; maxPriority = priority; }
        if (min !== null && priority >= minPriority) { result.min = min; minPriority = priority; }
        result.station = name; stationPriority = Math.max(stationPriority, priority);
        result.issued_at ??= issued;
      }
    }
  }
  if (!validReports) return emptyForecast(seminarId, date, 'UNAVAILABLE');
  if (result.label) result.state = 'READY';
  return result;
}

// Only fixed public JMA endpoints are fetched. Addresses and event names stay local.
export function createJmaClient(fetcher: typeof fetch = fetch, clock = () => new Date()) {
  const cache = new Map<string, { expires: number; value: Promise<unknown> }>();
  let running = 0; const waiting: (() => void)[] = [];
  async function limited(loader: () => Promise<unknown>) {
    if (running >= 4) await new Promise<void>(resolve => waiting.push(resolve)); else running++;
    try { return await loader(); } finally { const next = waiting.shift(); if (next) next(); else running--; }
  }
  async function json(url: string, limit: number) {
    const response = await fetcher(url, { cache: 'no-store', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } });
    if (!response.ok || !response.body) throw new Error('Forecast unavailable');
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > limit) throw new Error('Forecast too large'); chunks.push(value); }
    } catch (e) { await reader.cancel().catch(() => {}); throw e; }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  function cached(key: string, lifetime: number, loader: () => Promise<unknown>) {
    const now = clock().getTime(), current = cache.get(key); if (current && current.expires > now) return current.value;
    for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    const entry = { expires: now + lifetime, value: Promise.resolve<unknown>(null) };
    entry.value = loader().catch(e => { entry.expires = clock().getTime() + 5 * 60000; throw e; }); cache.set(key, entry); return entry.value;
  }
  return {
    areas: () => cached('areas', 24 * 3600000, () => json('https://www.jma.go.jp/bosai/common/const/area.json', 2 * 1024 * 1024)),
    forecast: (office: string) => {
      if (!/^\d{6}$/.test(office)) return Promise.reject(new Error('Invalid forecast area'));
      return cached(office, 3600000, () => limited(() => json(`https://www.jma.go.jp/bosai/forecast/data/forecast/${office}.json`, 512 * 1024)));
    },
  };
}
export type WeatherEvent = Pick<Seminar, 'id' | 'dates' | 'venue' | 'delivery_method' | 'session_delivery_methods'>;
export async function eventWeather(events: WeatherEvent[], client: ReturnType<typeof createJmaClient>, now = new Date()): Promise<EventWeatherData> {
  const today = todayInTokyo(now), sessions = events.flatMap(e => [...new Set(e.dates)].filter(date => inWeatherWindow(date, today) && eventMethodForDate(e, date) !== 'ONLINE').map(date => ({ event: e, date })));
  if (!sessions.length) return { as_of_date: today, forecasts: [] };
  let areas: unknown;
  if (sessions.some(p => addressPrefecture(p.event.venue))) {
    try {
      const value = await client.areas(), data = obj(value);
      if (['offices', 'class10s', 'class15s', 'class20s'].every(key => Object.keys(obj(data[key])).length > 0)) areas = value;
    } catch { /* Report the outage on relevant event cards, without affecting the event API. */ }
  }
  const forecasts = await Promise.all(sessions.map(async ({ event, date }) => {
    if (!addressPrefecture(event.venue)) return emptyForecast(event.id, date, 'MISSING_LOCATION');
    if (!areas) return emptyForecast(event.id, date, 'UNAVAILABLE');
    const location = resolveForecastLocation(event.venue, areas);
    if (!location) return emptyForecast(event.id, date, 'MISSING_LOCATION');
    try { return parseJmaForecast(await client.forecast(location.office), location, event.id, date, now); }
    catch { return emptyForecast(event.id, date, 'UNAVAILABLE'); }
  }));
  return { as_of_date: today, forecasts };
}
