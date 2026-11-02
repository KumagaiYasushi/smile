import assert from 'node:assert/strict';

export async function smokeTasks(client) {
  const json = async (...args) => (await client.request(...args)).json();
  const { members } = await json('/api/members');
  assert.equal(members.length, 2);
  assert.deepEqual(Object.keys(members[0]).sort(), ['email', 'id']);
  const first = await json('/api/seminars', 'POST', { name: '架空タスク検証' }, 201);
  const second = await json('/api/seminars', 'POST', { name: '別の架空タスク検証' }, 201);
  const endpoint = `/api/seminars/${first.id}/tasks`;
  try {
    await client.request(`/seminars/${first.id}/tasks`);
    assert.deepEqual((await json(endpoint)).tasks, []);
    const { task: created } = await json(endpoint, 'POST', { title: 'Task audit free text marker', description: 'Description marker',
      due_date: '2027-01-01', assignee_id: members[0].id, collaborator_ids: members.map((member) => member.id), important: true }, 201);
    let task = created;
    for (const status of ['IN_PROGRESS', 'IN_REVIEW', 'DONE']) {
      task = (await json(`${endpoint}/${task.id}`, 'PATCH', { status, version: task.version })).task;
      assert.equal(task.status, status);
      assert.equal(task.due_date, '2027-01-01');
      assert.equal(task.collaborator_ids.length, 2);
    }
    const detail = await json(`${endpoint}/${task.id}`);
    assert.equal(detail.history.length, 4);
    assert.ok(detail.history.every((entry) => entry.actor_id === members[0].id));
    assert.ok(!JSON.stringify(detail.history).includes('marker'));
    await client.request(`${endpoint}/${task.id}`, 'PATCH', { status: 'NOT_STARTED', version: 1 }, 409);
    await client.request(`${endpoint}/${task.id}`, 'DELETE', { version: 1 }, 409);
    const other = `/api/seminars/${second.id}/tasks/${task.id}`;
    for (const [method, body] of [['GET', undefined], ['PATCH', { status: 'NOT_STARTED', version: task.version }], ['DELETE', { version: task.version }]]) {
      await client.request(other, method, body, 404);
    }
    for (const input of [{ title: '' }, { title: 'x', due_date: '2026-02-30' }, { title: 'x', status: 'INVALID' },
      { title: 'x', assignee_id: 999 }, { title: 'x', collaborator_ids: [members[0].id, 999] }, { title: 'x', actor_id: 1 }]) {
      await client.request(endpoint, 'POST', input, 400);
    }
    await client.request(`${endpoint}/${task.id}`, 'PATCH', { description: 'x', version: task.version, actor_id: 1 }, 400);
    await client.request(`${endpoint}/${task.id}`, 'PATCH', { status: 'NOT_STARTED' }, 400);
    await client.request(endpoint, 'POST', { title: 'rejected CSRF' }, 403, { Origin: 'https://untrusted.invalid' });
    assert.equal((await json(endpoint)).tasks.length, 1);
    task = (await json(`${endpoint}/${task.id}`, 'PATCH', { due_date: null, assignee_id: null, collaborator_ids: [], version: task.version })).task;
    assert.equal(task.due_date, null);
    assert.equal(task.assignee_id, null);
    assert.deepEqual(task.collaborator_ids, []);
    await client.request(`${endpoint}/${task.id}`, 'DELETE', { version: task.version });
    await client.request(`${endpoint}/${task.id}`, 'GET', undefined, 404);
    assert.deepEqual((await json(endpoint)).tasks, []);
    // Parent deletion must not leave task or collaborator rows behind.
    await json(endpoint, 'POST', { title: 'cascade check', collaborator_ids: [members[0].id] }, 201);
    console.log('PASS: authenticated task CRUD, four states, assignment, deadline/history, input validation, stale-version conflicts, event scope and CSRF');
  } finally {
    await client.request(`/api/seminars/${first.id}`, 'DELETE');
    await client.request(`/api/seminars/${second.id}`, 'DELETE');
  }
}
