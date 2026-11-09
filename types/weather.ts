import { todayInTokyo } from './task.ts';

export type WeatherState = 'READY' | 'MISSING_LOCATION' | 'UNPUBLISHED' | 'UNAVAILABLE';
export type EventForecast = {
  seminar_id: number; date: string; state: WeatherState;
  label: string | null; icon: string; severe: boolean;
  max: number | null; min: number | null; region: string | null; station: string | null;
  issued_at: string | null; source_url: string | null;
};
export type EventWeatherData = { as_of_date: string; forecasts: EventForecast[] };

// Calendar dates in Japan, including the event day and exactly seven days ahead.
export function inWeatherWindow(date: string, today = todayInTokyo()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  const value = Date.parse(`${date}T00:00:00Z`), start = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(value) && Number.isFinite(start) && new Date(value).toISOString().slice(0, 10) === date
    && value >= start && value <= start + 7 * 86400000;
}

const WEATHER_LABELS: Record<string, string> = {
  '100': '晴れ', '101': '晴れ時々曇り', '102': '晴れ一時雨', '103': '晴れ時々雨', '104': '晴れ一時雪', '105': '晴れ時々雪',
  '106': '晴れ一時雨か雪', '107': '晴れ時々雨か雪', '108': '晴れ一時雨か雷雨', '110': '晴れのち時々曇り', '111': '晴れのち曇り',
  '112': '晴れのち一時雨', '113': '晴れのち時々雨', '114': '晴れのち雨', '115': '晴れのち一時雪', '116': '晴れのち時々雪',
  '117': '晴れのち雪', '118': '晴れのち雨か雪', '119': '晴れのち雨か雷雨', '120': '晴れ朝夕一時雨', '121': '晴れ朝のうち雨',
  '122': '晴れ夕方一時雨', '123': '晴れ山沿い雷雨', '124': '晴れ山沿い雪', '125': '晴れ午後は雷雨', '126': '晴れ昼頃から雨',
  '127': '晴れ夕方から雨', '128': '晴れ夜は雨', '130': '朝のうち霧のち晴れ', '131': '晴れ明け方霧', '132': '晴れ朝夕曇り',
  '140': '晴れ時々雨で雷を伴う', '160': '晴れ一時雪か雨', '170': '晴れ時々雪か雨', '181': '晴れのち雪か雨',
  '200': '曇り', '201': '曇り時々晴れ', '202': '曇り一時雨', '203': '曇り時々雨', '204': '曇り一時雪', '205': '曇り時々雪',
  '206': '曇り一時雨か雪', '207': '曇り時々雨か雪', '208': '曇り一時雨か雷雨', '209': '霧', '210': '曇りのち時々晴れ',
  '211': '曇りのち晴れ', '212': '曇りのち一時雨', '213': '曇りのち時々雨', '214': '曇りのち雨', '215': '曇りのち一時雪',
  '216': '曇りのち時々雪', '217': '曇りのち雪', '218': '曇りのち雨か雪', '219': '曇りのち雨か雷雨', '220': '曇り朝夕一時雨',
  '221': '曇り朝のうち雨', '222': '曇り夕方一時雨', '223': '曇り日中時々晴れ', '224': '曇り昼頃から雨', '225': '曇り夕方から雨',
  '226': '曇り夜は雨', '228': '曇り昼頃から雪', '229': '曇り夕方から雪', '230': '曇り夜は雪', '231': '曇り海上海岸は霧か霧雨',
  '240': '曇り時々雨で雷を伴う', '250': '曇り時々雪で雷を伴う', '260': '曇り一時雪か雨', '270': '曇り時々雪か雨', '281': '曇りのち雪か雨',
  '300': '雨', '301': '雨時々晴れ', '302': '雨時々止む', '303': '雨時々雪', '304': '雨か雪', '306': '大雨', '308': '暴風雨',
  '309': '雨一時雪', '311': '雨のち晴れ', '313': '雨のち曇り', '314': '雨のち時々雪', '315': '雨のち雪', '316': '雨か雪のち晴れ',
  '317': '雨か雪のち曇り', '320': '朝のうち雨のち晴れ', '321': '朝のうち雨のち曇り', '322': '雨朝晩一時雪', '323': '雨昼頃から晴れ',
  '324': '雨夕方から雪', '325': '雨夕方から晴れ', '326': '雨夜は雪', '327': '雨夜は晴れ', '328': '雨で雷を伴う', '329': '雨一時みぞれ',
  '340': '雪か雨', '350': '雨で雷を伴う', '361': '雪か雨のち晴れ', '371': '雪か雨のち曇り',
  '400': '雪', '401': '雪時々晴れ', '402': '雪時々止む', '403': '雪時々雨', '405': '大雪', '406': '風雪強い', '407': '暴風雪',
  '409': '雪一時雨', '411': '雪のち晴れ', '413': '雪のち曇り', '414': '雪のち雨', '420': '朝のうち雪のち晴れ', '421': '朝のうち雪のち曇り',
  '422': '雪昼頃から雨', '423': '雪夕方から雨', '425': '雪昼頃から晴れ', '426': '雪夕方から曇り', '427': '雪夜は晴れ', '450': '雪で雷を伴う',
};
export function weatherDescription(code: unknown, text?: unknown) {
  const key = typeof code === 'string' && /^\d{3}$/.test(code) ? code : '';
  const label = typeof text === 'string' && text.trim() && text.length <= 200
    ? text.replace(/[\s　]+/g, ' ').trim() : WEATHER_LABELS[key] ?? null;
  const severe = ['306', '308', '405', '406', '407'].includes(key) || /大雨|豪雨|暴風|大雪/.test(label ?? '');
  const icon = /雪|みぞれ/.test(label ?? '') ? '🌨️' : severe || /雷/.test(label ?? '') ? '⛈️'
    : /雨/.test(label ?? '') ? '🌧️' : /曇|くもり/.test(label ?? '') ? '☁️' : /晴/.test(label ?? '') ? '☀️' : /霧/.test(label ?? '') ? '🌫️' : '';
  return { label, icon, severe };
}
