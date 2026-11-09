// Synthetic JMA-shaped responses. These are fixtures, not captured/live forecasts.
export const areas = {
  offices: { '130000': { name: '東京都', children: ['130010', '130040'] }, '140000': { name: '神奈川県', children: ['140010'] }, '016000': { name: '石狩・空知・後志地方', children: ['016010'] } },
  class10s: { '130010': { name: '東京地方', parent: '130000' }, '130040': { name: '小笠原諸島', parent: '130000' }, '140010': { name: '東部', parent: '140000' }, '016010': { name: '石狩地方', parent: '016000' } },
  class15s: { '130011': { parent: '130010' }, '130041': { parent: '130040' }, '140011': { parent: '140010' }, '016011': { parent: '016010' } },
  class20s: { '1310400': { name: '新宿区', parent: '130011' }, '1310600': { name: '台東区', parent: '130011' }, '1342100': { name: '小笠原村', parent: '130041' }, '1410000': { name: '横浜市', parent: '140011' }, '0110000': { name: '札幌市', parent: '016011' } },
};
export function offset(date, amount) { return new Date(Date.parse(date + 'T00:00:00Z') + amount * 86400000).toISOString().slice(0, 10); }
export function forecastFixture(today = '2026-11-09') {
  const issued = today + 'T00:00:00+09:00', short = [0, 1, 2].map(n => offset(today, n) + 'T00:00:00+09:00');
  const weekly = [1, 2, 3, 4, 5, 6, 7].map(n => offset(today, n) + 'T00:00:00+09:00');
  return [
    { publishingOffice: '架空気象台', reportDatetime: issued, timeSeries: [
      { timeDefines: short, areas: [{ area: { name: '東京地方', code: '130010' }, weatherCodes: ['100', '200', '300'], weathers: ['晴れ', 'くもり', '雨'] }] },
      { timeDefines: [today + 'T00:00:00+09:00', today + 'T09:00:00+09:00', offset(today, 1) + 'T00:00:00+09:00', offset(today, 1) + 'T09:00:00+09:00'], areas: [{ area: { name: '東京', code: '44132' }, temps: ['-2', '0', '10', '20'] }] },
    ] },
    { publishingOffice: '架空気象台', reportDatetime: issued, timeSeries: [
      { timeDefines: weekly, areas: [{ area: { name: '東京都', code: '130010' }, weatherCodes: ['101', '200', '300', '400', '306', '308', '306'] }] },
      { timeDefines: weekly, areas: [{ area: { name: '東京', code: '44132' }, tempsMax: ['21', '22', '23', '24', '25', '26', '27'], tempsMin: ['11', '12', '13', '14', '15', '16', '-3'] }] },
    ] },
  ];
}
