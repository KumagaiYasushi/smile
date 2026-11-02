import assert from 'node:assert/strict';
import { keepSchedule } from './smoke-reschedule.mjs';

export async function smokeStaffAttendance(client) {
  const json = async (...args) => (await client.request(...args)).json();
  const eventIds = [];
  const dates = ['2027-06-01', '2027-06-08'];
  try {
    for (const event_type of ['BASIC_COURSE', 'LECTURE', 'SEMINAR']) {
      const event = await json('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: '架空の出欠予定検証', event_type, dates,
        lecturer_role: 'SOCIETY_LECTURER', lecturer_name: '架空講師', assistant_members: ['架空サポート'], generate_tasks: false }, 201);
      eventIds.push(event.id);
      const path = `/api/seminars/${event.id}/staff-attendance`;
      await client.request(`/seminars/${event.id}/staff-attendance`);
      assert.equal((await json(path)).people.length, 0);
      assert.equal((await json(`${path}/import`, 'POST', { schedule: dates })).added, 2);
      assert.equal((await json(`${path}/import`, 'POST', { schedule: dates })).added, 0);
      const initial = await json(path);
      assert.ok(initial.people.every(person => person.responses[dates[0]] === 'UNANSWERED'));
      let lecturer = initial.people.find(person => person.role === 'SOCIETY_LECTURER');
      const input = { name: lecturer.name, role: lecturer.role, schedule: dates,
        responses: { [dates[0]]: 'ATTENDING', [dates[1]]: 'ABSENT' } };
      lecturer = (await json(`${path}/${lecturer.id}`, 'PATCH', { ...input, version: lecturer.version })).person;
      assert.equal(lecturer.responses[dates[0]], 'ATTENDING');
      assert.equal(lecturer.responses[dates[1]], 'ABSENT');
      await client.request(`${path}/${lecturer.id}`, 'PATCH', { ...input, version: 1 }, 409);
      await client.request(`${path}/${lecturer.id}`, 'DELETE', { version: 1 }, 409);
      const other = await json('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: '架空の別イベント', dates, generate_tasks: false }, 201);
      eventIds.push(other.id);
      await client.request(`/api/seminars/${other.id}/staff-attendance/${lecturer.id}`, 'PATCH', { ...input, version: lecturer.version }, 404);
      await client.request(path, 'POST', { ...input, name: '不正', responses: { [dates[0]]: 'toString', [dates[1]]: 'ABSENT' } }, 400);
      await client.request(path, 'POST', input, 409);
      await client.request(`${path}/import`, 'POST', { schedule: dates }, 403, { Origin: 'https://untrusted.invalid' });
      await client.request(`${path}/${lecturer.id}`, 'PATCH', { ...input, version: lecturer.version }, 403, { Origin: 'https://untrusted.invalid' });
      await client.request(`${path}/${lecturer.id}`, 'DELETE', { version: lecturer.version }, 403, { Origin: 'https://untrusted.invalid' });
      const manual = (await json(path, 'POST', { ...input, name: '追加サポート', role: 'SOCIETY_SUPPORT' }, 201)).person;
      const response = await client.request(path);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      assert.equal(result.people.length, 3);
      assert.equal(result.history[0].actor_id, (await json('/api/auth/me')).user.id);
      assert.ok(!JSON.stringify(result.history).includes('架空講師'));
      const newDates = ['2027-07-01'];
      await keepSchedule(client, event.id, newDates);
      await client.request(`${path}/${lecturer.id}`, 'PATCH', { ...input, version: lecturer.version }, 409);
      assert.equal((await json(path)).people.find(person => person.id === lecturer.id).responses[newDates[0]], undefined);
      lecturer = (await json(`${path}/${lecturer.id}`, 'PATCH', { ...input, schedule: newDates,
        responses: { [newDates[0]]: 'TENTATIVE' }, version: lecturer.version })).person;
      assert.equal(lecturer.responses[dates[0]], 'ATTENDING');
      assert.equal(lecturer.responses[newDates[0]], 'TENTATIVE');
      await client.request(`${path}/${manual.id}`, 'DELETE', { version: manual.version });
      assert.equal((await json(path)).people.length, 2);
    }
    console.log('PASS: all three event types support staff plans, per-date answers, imports, scope, versions, CSRF, audit and changed-date confirmation');
  } finally {
    for (const id of eventIds) await client.request(`/api/seminars/${id}`, 'DELETE');
  }
}
