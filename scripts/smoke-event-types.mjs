import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

// The authentication smoke runner supplies its isolated local server and session.
export async function smokeEventTypes(base, cookie) {
const ids = [];

async function request(path, method = 'GET', body, expectedStatus = 200) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: base, Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.equal(response.status, expectedStatus, `${method} ${path}`);
  return response.json();
}

try {
  const home = await fetch(base, { headers: { Cookie: cookie } });
  assert.equal(home.status, 200);
  // The client-rendered list initially serves its loading state in the HTML.
  assert.match(await home.text(), /セミナー管理システム/);
  const form = await fetch(`${base}/seminars/new`, { headers: { Cookie: cookie } });
  assert.equal(form.status, 200);
  const formHtml = await form.text();
  for (const label of ['ベーシックコース', '講演会', 'セミナー', '現地開催', 'オンライン', '現地開催＋オンライン']) {
    assert.ok(formHtml.includes(label));
  }

  for (const event_type of ['BASIC_COURSE', 'LECTURE', 'SEMINAR', undefined]) {
    const created = await request('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: '架空の種別検証イベント', event_type }, 201);
    ids.push(created.id);
    const path = `/api/seminars/${created.id}`;
    const expected = event_type ?? 'SEMINAR';
    assert.equal(created.event_type, expected);
    assert.equal(created.delivery_method, null);
    assert.equal((await request(path)).event_type, expected);
    assert.equal((await request(path, 'PATCH', { venue: '架空会場' })).event_type, expected);
    assert.equal((await request(path, 'PATCH', { event_type: 'LECTURE' })).event_type, 'LECTURE');
    for (const invalid of ['OTHER', 'toString', '', null, 1]) {
      await request(path, 'PATCH', { event_type: invalid }, 400);
      await request('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: '不正入力', event_type: invalid }, 400);
    }
    assert.equal((await request(path)).event_type, 'LECTURE');
    const list = await request('/api/seminars');
    assert.equal(list.find((item) => item.id === created.id).event_type, 'LECTURE');
    for (const suffix of ['', '/edit']) {
      assert.equal((await fetch(`${base}/seminars/${created.id}${suffix}`, { headers: { Cookie: cookie } })).status, 200);
    }
  }
  for (const event_type of ['BASIC_COURSE', 'LECTURE', 'SEMINAR']) {
    for (const delivery_method of ['ONSITE', 'ONLINE', 'HYBRID']) {
      const created = await request('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: '架空の開催方法検証', event_type, delivery_method }, 201);
      ids.push(created.id);
      const path = `/api/seminars/${created.id}`;
      assert.equal(created.delivery_method, delivery_method);
      assert.equal((await request(path)).delivery_method, delivery_method);
      assert.equal((await request(path, 'PATCH', { notes: '開催方法を保持' })).delivery_method, delivery_method);
      assert.equal((await request('/api/seminars')).find(item => item.id === created.id).delivery_method, delivery_method);
      for (const next of ['ONLINE', 'HYBRID', 'ONSITE']) {
        assert.equal((await request(path, 'PATCH', { delivery_method: next })).delivery_method, next);
      }
      for (const invalid of ['OTHER', 'toString', '', null, 1, [], {}]) {
        await request(path, 'PATCH', { delivery_method: invalid }, 400);
        await request('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: '不正入力', delivery_method: invalid }, 400);
      }
      assert.equal((await request(path)).delivery_method, 'ONSITE');
    }
  }
  console.log('PASS: all nine event-type/delivery-method combinations, updates, list and invalid values');
  console.log('PASS: page responses, event-type options, three types, default compatibility, updates, list, invalid values');
} finally {
  for (const id of ids) {
    await request(`/api/seminars/${id}`, 'DELETE');
    await request(`/api/seminars/${id}`, 'GET', undefined, 404);
  }
}
console.log('PASS: all synthetic events removed');

}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.SMILE_SESSION) throw new Error('認証済みセッションが必要です。npm run test:smoke を使用してください');
  await smokeEventTypes('http://127.0.0.1:3000', process.env.SMILE_SESSION);
}
