import assert from 'node:assert/strict';
import { relativeDueDate } from '../types/task-template.ts';

export async function smokeDashboard(client) {
  const json = async (...args) => (await client.request(...args)).json();
  const baseline = await json('/api/dashboard');
  assert.equal(baseline.total, 0);
  const today = baseline.as_of_date;
  const actor = (await json('/api/auth/me')).user.id;
  const other = (await json('/api/members')).members.find((member) => member.id !== actor).id;
  const eventIds = [];
  async function event(name, event_type) {
    const result = await json('/api/seminars', 'POST', { name, event_type, generate_tasks: false }, 201);
    eventIds.push(result.id); return result.id;
  }
  async function task(seminarId, title, fields) {
    return (await json(`/api/seminars/${seminarId}/tasks`, 'POST', { title, ...fields }, 201)).task;
  }
  try {
    await client.request('/dashboard');
    const first = await event('架空の集計検証A', 'SEMINAR');
    const second = await event('架空の集計検証B', 'LECTURE');
    const overdue = await task(first, '架空の期限超過', { due_date: relativeDueDate(today, -1), status: 'IN_PROGRESS', important: true });
    const review = await task(first, '架空の確認待ち', { due_date: today, status: 'IN_REVIEW', important: true, assignee_id: actor, collaborator_ids: [actor, other] });
    const boundary = await task(second, '架空の期限境界', { due_date: relativeDueDate(today, 7), important: true, assignee_id: other, collaborator_ids: [actor] });
    const undated = await task(first, '架空の期限未定', { important: true, assignee_id: actor });
    await task(second, '架空の完了済み', { due_date: relativeDueDate(today, -1), important: true, status: 'DONE', assignee_id: actor });
    await task(second, '架空の未割当', { due_date: relativeDueDate(today, 3), status: 'IN_REVIEW' });
    const response = await client.request('/api/dashboard');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.deepEqual(result.counts, { ALL: 5, OVERDUE: 1, IN_REVIEW: 2, UNASSIGNED: 2, IMPORTANT: 2, MINE: 3 });
    assert.equal(result.event_count, 2);
    assert.equal(result.items[0].id, overdue.id);
    assert.equal(result.items.find((item) => item.id === boundary.id).seminar_id, second);
    const mine = await json('/api/dashboard?filter=MINE');
    assert.deepEqual(new Set(mine.items.map((item) => item.id)), new Set([review.id, boundary.id, undated.id]));
    for (const filter of ['OVERDUE', 'IN_REVIEW', 'UNASSIGNED', 'IMPORTANT']) {
      const selected = await json(`/api/dashboard?filter=${filter}`);
      assert.equal(selected.total, result.counts[filter]);
      assert.equal(selected.items.length, selected.total);
    }
    assert.equal((await json('/api/dashboard?filter=IMPORTANT&days=3')).total, 1);
    assert.equal((await json('/api/dashboard?filter=IMPORTANT&days=30')).total, 2);
    assert.equal((await json('/api/dashboard?page=999')).page, 1);
    for (const query of ['filter=toString', 'days=5', 'page=0', 'actor=2', 'user_id=2', 'filter=ALL&filter=MINE']) {
      await client.request(`/api/dashboard?${query}`, 'GET', undefined, 400);
    }
    assert.equal((await json(`/api/seminars/${first}/tasks/${review.id}`)).task.version, review.version);
    await client.request(`/api/seminars/${first}/tasks/${review.id}`, 'PATCH', { status: 'DONE', version: review.version });
    const updated = await json('/api/dashboard');
    assert.equal(updated.counts.ALL, 4);
    assert.equal(updated.counts.MINE, 2);
    assert.equal(updated.counts.IN_REVIEW, 1);
    console.log('PASS: authenticated cross-event dashboard, personal membership/deduplication, category filters, horizons, validation and live counts after task completion');
  } finally {
    for (const id of eventIds) await client.request(`/api/seminars/${id}`, 'DELETE');
  }
  assert.equal((await json('/api/dashboard')).total, 0);
}
