import assert from 'node:assert/strict';

export async function smokeVenues(client) {
  const json = async (...args) => (await client.request(...args)).json();
  const ids = [];
  let venue;
  try {
    await client.request('/venues');
    venue = (await json('/api/venues', 'POST', { name: '架空の会場台帳検証', room: '第1会議室', address: '架空の住所',
      contact_person: '架空窓口', capacity: 50, reference_fee: 10000, fee_unit: '半日' }, 201)).venue;
    const path = `/api/venues/${venue.id}`;
    assert.equal((await json(`/api/venues?query=${encodeURIComponent('架空の住所')}`)).venues[0].id, venue.id);
    for (const event_type of ['BASIC_COURSE', 'LECTURE', 'SEMINAR']) {
      const event = await json('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: '架空の会場選択検証', event_type, generate_tasks: false,
        venue_id: venue.id, venue: '保存時の会場名と住所', venue_fee: 12345 }, 201);
      ids.push(event.id);
      assert.equal(event.venue_id, venue.id);
      assert.equal((await json(`/api/seminars/${event.id}`, 'PATCH', { notes: '無関係な編集' })).venue_id, venue.id);
    }
    venue = (await json(path, 'PATCH', { version: venue.version, name: '変更後の架空会場', address: '変更後の住所', reference_fee: 20000 })).venue;
    await client.request(path, 'PATCH', { version: 1, name: '競合' }, 409);
    for (const id of ids) {
      const event = await json(`/api/seminars/${id}`);
      assert.equal(event.venue, '保存時の会場名と住所'); assert.equal(event.venue_fee, 12345); assert.equal(event.venue_id, venue.id);
    }
    venue = (await json(path, 'PATCH', { version: venue.version, active: false })).venue;
    assert.ok(!(await json('/api/venues')).venues.some(item => item.id === venue.id));
    assert.ok((await json('/api/venues?status=INACTIVE')).venues.some(item => item.id === venue.id));
    await client.request('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: '利用停止選択', generate_tasks: false, venue_id: venue.id }, 400);
    assert.equal((await json(`/api/seminars/${ids[0]}`, 'PATCH', { venue_id: venue.id, notes: '既存の紐付けを保持' })).venue_id, venue.id);
    await client.request(`/api/seminars/${ids[0]}`, 'PATCH', { venue_id: null });
    await client.request(`/api/seminars/${ids[0]}`, 'PATCH', { venue_id: venue.id }, 400);
    venue = (await json(path, 'PATCH', { version: venue.version, active: true })).venue;
    await client.request(`/api/seminars/${ids[0]}`, 'PATCH', { venue_id: venue.id });
    for (const badId of [0, -1, '1', {}, 99999999]) {
      await client.request(`/api/seminars/${ids[0]}`, 'PATCH', { venue_id: badId }, 400);
      await client.request('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: '不正ID', generate_tasks: false, venue_id: badId }, 400);
    }
    for (const bad of [{ name: '' }, { capacity: -1 }, { reference_fee: '100' }, { website: 'javascript:alert(1)' }, { email: 'invalid' }, { actor_id: 2 }]) {
      await client.request(path, 'PATCH', { version: venue.version, ...bad }, 400);
    }
    for (const query of ['status=BAD', 'query=a&query=b', 'user_id=2']) await client.request(`/api/venues?${query}`, 'GET', undefined, 400);
    await client.request('/api/venues', 'POST', { name: '拒否' }, 403, { Origin: 'https://untrusted.invalid' });
    await client.request(path, 'PATCH', { version: venue.version, active: false }, 403, { Origin: 'https://untrusted.invalid' });
    const response = await client.request(path); assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.ok(!JSON.stringify(result.history).includes('架空窓口'));
    assert.ok(!JSON.stringify(result.history).includes('変更後の住所'));
    assert.equal(result.history[0].actor_id, (await json('/api/auth/me')).user.id);
    console.log('PASS: venue directory CRUD/archive, literal search, all event types, stable event snapshots, inactive link guards, versions, validation, audit and CSRF');
  } finally {
    for (const id of ids) await client.request(`/api/seminars/${id}`, 'DELETE');
    if (venue) { const current = (await json(`/api/venues/${venue.id}`)).venue; await client.request(`/api/venues/${venue.id}`, 'PATCH', { version: current.version, active: false }); }
  }
}
