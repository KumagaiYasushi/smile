import assert from 'node:assert/strict';
import { keepSchedule } from './smoke-reschedule.mjs';

export async function smokeTemplates(client) {
  const json = async (...args) => (await client.request(...args)).json();
  const eventIds = [];
  const templateIds = [];
  async function createEvent(body) {
    const event = await json('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', ...body }, 201); eventIds.push(event.id); return event;
  }
  async function createTemplate(body) {
    const { template } = await json('/api/task-templates', 'POST', body, 201); templateIds.push(template.id); return template;
  }
  try {
    await client.request('/task-templates');
    await client.request('/api/task-templates?event_type=INVALID', 'GET', undefined, 400);
    await client.request('/api/task-templates', 'POST', { title: 'missing fields' }, 400);
    await client.request('/api/task-templates', 'POST', { event_type: 'SEMINAR', title: 'CSRF', relative_days: 0 }, 403, { Origin: 'https://untrusted.invalid' });
    let template = await createTemplate({ event_type: 'SEMINAR', title: '架空の開催前タスク', description: 'Generated snapshot', relative_days: -30, important: true });
    await createTemplate({ event_type: 'LECTURE', title: '架空の開催後タスク', relative_days: 7 });
    await createTemplate({ event_type: 'BASIC_COURSE', title: '架空の当日タスク', relative_days: 0 });
    assert.equal((await json('/api/task-templates?event_type=SEMINAR')).templates.length, 1);
    const seminar = await createEvent({ name: '架空の自動生成', dates: ['2027-01-01'] });
    const endpoint = `/api/seminars/${seminar.id}/tasks`;
    const generated = (await json(endpoint)).tasks;
    assert.equal(generated.length, 1);
    assert.equal(generated[0].due_date, '2026-12-02');
    assert.equal(generated[0].important, true);
    assert.equal(generated[0].assignee_id, null);
    const before = (await json('/api/seminars')).length;
    await client.request('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: 'must roll back', dates: ['2027-01-01','2027-02-01'] }, 400);
    await client.request('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: 'must roll back too' }, 400);
    assert.equal((await json('/api/seminars')).length, before);
    const lecture = await createEvent({ name: '架空の講演会', event_type: 'LECTURE', dates: ['2027-01-01'] });
    assert.equal((await json(`/api/seminars/${lecture.id}/tasks`)).tasks[0].due_date, '2027-01-08');
    const basic = await createEvent({ name: '架空の複数回', event_type: 'BASIC_COURSE', dates: ['2027-05-01','2027-06-01'], task_base_date: '2027-06-01' });
    assert.equal((await json(`/api/seminars/${basic.id}/tasks`)).tasks[0].due_date, '2027-06-01');
    const draft = await createEvent({ name: '架空の下書き', generate_tasks: false });
    const draftEndpoint = `/api/seminars/${draft.id}/tasks`;
    assert.deepEqual((await json(draftEndpoint)).tasks, []);
    await client.request(`${draftEndpoint}/template-preview`, 'POST', {}, 400);
    await keepSchedule(client, draft.id, ['2027-03-01']);
    let preview = (await json(`${draftEndpoint}/template-preview`, 'POST', {})).preview;
    assert.equal(preview.items.length, 1);
    await client.request(`${draftEndpoint}/apply-templates`, 'POST', {}, 400);
    template = (await json(`/api/task-templates/${template.id}`, 'PATCH', { relative_days: -7, version: template.version })).template;
    await client.request(`/api/task-templates/${template.id}`, 'PATCH', { title: 'stale', version: 1 }, 409);
    await client.request(`/api/task-templates/${template.id}`, 'PATCH', { event_type: 'LECTURE', version: template.version }, 400);
    await client.request(`${draftEndpoint}/apply-templates`, 'POST', { preview_token: preview.preview_token }, 409);
    preview = (await json(`${draftEndpoint}/template-preview`, 'POST', {})).preview;
    assert.equal(preview.items[0].due_date, '2027-02-22');
    const payload = { base_date: preview.base_date, preview_token: preview.preview_token };
    const result = await json(`${draftEndpoint}/apply-templates`, 'POST', payload);
    assert.equal(result.created_count, 1);
    assert.equal((await json(`${draftEndpoint}/apply-templates`, 'POST', payload)).replayed, true);
    assert.equal((await json(draftEndpoint)).tasks.length, 1);
    assert.equal((await json(endpoint)).tasks[0].due_date, '2026-12-02'); // Template changes never overwrite event tasks.
    await client.request(`${draftEndpoint}/${result.task_ids[0]}`, 'DELETE', { version: 1 });
    const consumed = (await json(`${draftEndpoint}/template-preview`, 'POST', {})).preview;
    assert.equal(consumed.items.length, 0);
    assert.equal(consumed.skipped_count, 1);
    await json(`${draftEndpoint}/apply-templates`, 'POST', { preview_token: consumed.preview_token });
    assert.deepEqual((await json(draftEndpoint)).tasks, []);
    template = (await json(`/api/task-templates/${template.id}`, 'PATCH', { active: false, version: template.version })).template;
    const noTasks = await createEvent({ name: '架空の無効化確認' });
    assert.deepEqual((await json(`/api/seminars/${noTasks.id}/tasks`)).tasks, []);
    console.log('PASS: template CRUD/archival, automatic generation on creation, type/date selection, preview approval, atomic rollback, retries, deleted-task deduplication and immutable generated snapshots');
  } finally {
    for (const id of eventIds) await client.request(`/api/seminars/${id}`, 'DELETE');
    const { templates } = await json('/api/task-templates');
    for (const template of templates.filter((item) => templateIds.includes(item.id) && item.active)) {
      await client.request(`/api/task-templates/${template.id}`, 'PATCH', { active: false, version: template.version });
    }
  }
}
