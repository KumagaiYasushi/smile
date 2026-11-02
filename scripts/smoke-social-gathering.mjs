import assert from 'node:assert/strict';
import { keepSchedule } from './smoke-reschedule.mjs';

export async function smokeSocialGathering(client) {
  const json = async (...args) => (await client.request(...args)).json();
  const ids = [];
  const gathering = { status: 'HELD', start_at: '2027-06-01T18:30', end_at: '2027-06-01T20:30', venue: '架空の懇親会場', fee: 5000 };
  try {
    for (const event_type of ['BASIC_COURSE', 'LECTURE', 'SEMINAR']) {
      const event = await json('/api/seminars', 'POST', { name: '架空の懇親会検証', event_type, dates: ['2027-06-01'], social_gathering: gathering, generate_tasks: false }, 201);
      ids.push(event.id);
      const path = `/api/seminars/${event.id}`;
      assert.deepEqual(event.social_gathering, gathering);
      assert.deepEqual((await json(path)).social_gathering, gathering);
      assert.deepEqual((await json('/api/seminars')).find(item => item.id === event.id).social_gathering, gathering);
      assert.deepEqual((await json(path, 'PATCH', { photo_received: true })).social_gathering, gathering);
      assert.deepEqual((await json(path, 'PATCH', { social_gathering: { status: 'NOT_HELD' } })).social_gathering, { ...gathering, status: 'NOT_HELD' });
      assert.equal((await json(path, 'PATCH', { social_gathering: { status: 'HELD', fee: 0 } })).social_gathering.fee, 0);
      assert.equal((await json(path, 'PATCH', { social_gathering: { fee: null } })).social_gathering.fee, null);
      await json(path, 'PATCH', { social_gathering: gathering });
      for (const invalid of [null, [], { status: 'toString' }, { fee: -1 }, { fee: '5000' }, { fee: 1.5 },
        { start_at: '2027-02-30T18:30' }, { end_at: '2027-06-01T18:00' }, { start_at: '2027-06-01T18:30Z' },
        { venue: 'x'.repeat(2001) }, { attended: true }]) {
        await client.request(path, 'PATCH', { social_gathering: invalid }, 400);
        await client.request('/api/seminars', 'POST', { name: '不正な懇親会', generate_tasks: false,
          social_gathering: invalid && !Array.isArray(invalid) ? { ...gathering, ...invalid } : invalid }, 400);
      }
      assert.deepEqual((await json(path)).social_gathering, gathering);
      await client.request(path, 'PATCH', { social_gathering: { fee: 100 } }, 403, { Origin: 'https://untrusted.invalid' });
      await keepSchedule(client, event.id, ['2027-07-01']);
      assert.deepEqual((await json(path)).social_gathering, gathering, 'event date changes do not silently move the gathering');
      const legacy = await json('/api/seminars', 'POST', { name: '従来クライアント', generate_tasks: false }, 201);
      ids.push(legacy.id);
      assert.deepEqual(legacy.social_gathering, { status: 'UNDECIDED', start_at: null, end_at: null, venue: '', fee: null });
    }
    console.log('PASS: social gatherings for all event types, partial updates, unknown/free fees, invalid inputs, CSRF and independent dates');
  } finally {
    for (const id of ids) await client.request(`/api/seminars/${id}`, 'DELETE');
  }
}
