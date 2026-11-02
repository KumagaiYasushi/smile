import assert from 'node:assert/strict';
import { keepSchedule } from './smoke-reschedule.mjs';

export async function smokeLunch(client) {
  const json = async (...args) => (await client.request(...args)).json();
  const ids = [], dates = ['2027-06-01', '2027-06-08'];
  const input = { date: dates[0], target: 'LECTURER', target_details: '架空の講師', quantity: 3, unit_price: 1200,
    additional_cost: 500, shop_name: '架空のお店', shop_contact: '架空の住所', menu: '昼食セット', notes: '', status: 'PLANNED', schedule: dates };
  try {
    const other = await json('/api/seminars', 'POST', { name: '別の架空イベント', generate_tasks: false }, 201);
    ids.push(other.id);
    for (const event_type of ['BASIC_COURSE', 'LECTURE', 'SEMINAR']) {
      const event = await json('/api/seminars', 'POST', { name: '架空の昼食検証', event_type, dates, generate_tasks: false }, 201);
      ids.push(event.id);
      const path = `/api/seminars/${event.id}/lunch`;
      await client.request(`/seminars/${event.id}/lunch`);
      assert.equal((await json(path)).plans.length, 0);
      for (const target of ['LECTURER', 'EXTERNAL_LECTURER', 'SUPPORT', 'PARTICIPANT', 'OTHER']) {
        let plan = (await json(path, 'POST', { ...input, target }, 201)).plan;
        assert.equal(plan.target, target);
        assert.equal(plan.quantity * plan.unit_price + plan.additional_cost, 4100);
        plan = (await json(`${path}/${plan.id}`, 'PATCH', { ...input, target, quantity: 4, version: 1 })).plan;
        assert.equal(plan.quantity, 4);
        assert.equal(plan.shop_name, input.shop_name);
        await client.request(`${path}/${plan.id}`, 'PATCH', { ...input, target, version: 1 }, 409);
        await client.request(`${path}/${plan.id}`, 'DELETE', { version: 1 }, 409);
        await client.request(`/api/seminars/${other.id}/lunch/${plan.id}`, 'PATCH', { ...input, version: plan.version }, 404);
        await client.request(`/api/seminars/${other.id}/lunch/${plan.id}`, 'DELETE', { version: plan.version }, 404);
        await client.request(`${path}/${plan.id}`, 'PATCH', { ...input, version: plan.version }, 403, { Origin: 'https://untrusted.invalid' });
        await client.request(`${path}/${plan.id}`, 'DELETE', { version: plan.version }, 403, { Origin: 'https://untrusted.invalid' });
        await client.request(`${path}/${plan.id}`, 'DELETE', { version: plan.version });
      }
      await client.request(path, 'POST', input, 403, { Origin: 'https://untrusted.invalid' });
      for (const bad of [{ quantity: -1 }, { unit_price: '1200' }, { unit_price: 1.5 }, { additional_cost: -1 }, { target: 'toString' }, { date: '2027-06-15' }, { actor_id: 2 }]) {
        await client.request(path, 'POST', { ...input, ...bad }, 400);
      }
      let plan = (await json(path, 'POST', { ...input, quantity: null, unit_price: 0 }, 201)).plan;
      assert.equal(plan.quantity, null); assert.equal(plan.unit_price, 0);
      const response = await client.request(path); assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      assert.ok(!JSON.stringify(result.history).includes('架空のお店'));
      assert.equal(result.history[0].actor_id, (await json('/api/auth/me')).user.id);
      await keepSchedule(client, event.id, ['2027-07-01']);
      assert.equal((await json(path)).plans[0].date, dates[0]);
      await client.request(`${path}/${plan.id}`, 'PATCH', { ...input, version: plan.version }, 409);
      plan = (await json(`${path}/${plan.id}`, 'PATCH', { ...input, schedule: ['2027-07-01'], status: 'CANCELLED', version: plan.version })).plan;
      assert.equal(plan.date, dates[0]);
      plan = (await json(`${path}/${plan.id}`, 'PATCH', { ...input, schedule: ['2027-07-01'], date: '2027-07-01', version: plan.version })).plan;
      assert.equal(plan.date, '2027-07-01');
    }
    console.log('PASS: lunch plans for three event types and five targets including external lecturers, costs, unknown/free values, scope, concurrency, validation, audit, CSRF and changed-date confirmation');
  } finally {
    for (const id of ids) await client.request(`/api/seminars/${id}`, 'DELETE');
  }
}
