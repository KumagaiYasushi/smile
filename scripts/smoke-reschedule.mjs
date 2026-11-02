import assert from 'node:assert/strict';
import {createTemplateStore} from '../lib/task-templates.ts';

export async function keepSchedule(client, eventId, dates) {
  const preview = (await (await client.request(`/api/seminars/${eventId}/schedule-preview`, 'POST', { dates })).json()).preview;
  await client.request(`/api/seminars/${eventId}/reschedule`, 'POST', { dates, base_date: preview.base_date, preview_token: preview.preview_token,
    decisions: preview.items.map((item) => ({ task_id: item.task_id, action: 'keep' })) });
}

export async function smokeReschedule(client,db) {
  const json = async (...args) => (await client.request(...args)).json();
  const { template } = await json('/api/task-templates', 'POST', { event_type: 'SEMINAR', title: '架空の日程変更検証', relative_days: -30 }, 201);
  let event;
  try {
    event = await json('/api/seminars', 'POST', { occurrence_type: 'MULTIPLE', name: '架空の日程変更', dates: ['2027-01-01'], venue: 'original' }, 201);
    // Historical generated-task fixture: generation is no longer exposed by the app.
    const actor=(await json('/api/auth/me')).user.id;
    createTemplateStore(db).createEvent(()=>event,actor,true,event.dates[0]);
    const root = `/api/seminars/${event.id}`;
    await client.request(`/seminars/${event.id}/reschedule`);
    let generated = (await json(`${root}/tasks`)).tasks[0];
    generated = (await json(`${root}/tasks/${generated.id}`, 'PATCH', { status: 'DONE', due_date: '2027-01-10', version: generated.version })).task;
    const { task: manual } = await json(`${root}/tasks`, 'POST', { title: 'Private audit free-text marker', due_date: '2027-01-05' }, 201);
    await client.request(root, 'PATCH', { dates: ['2027-02-01'] }, 409);
    assert.deepEqual((await json(root)).dates, ['2027-01-01']);
    let preview = (await json(`${root}/schedule-preview`, 'POST', { dates: ['2027-02-01'] })).preview;
    assert.equal(preview.items.find((item) => item.task_id === generated.id).manually_changed, true);
    assert.equal(preview.items.find((item) => item.task_id === generated.id).proposed_due_date, '2027-01-02');
    let payload = { dates: preview.new_dates, base_date: preview.base_date, preview_token: preview.preview_token, decisions: [
      ...preview.items.map(item=>item.task_id===generated.id?{task_id:item.task_id,action:'proposed'}:item.task_id===manual.id?{task_id:item.task_id,action:'custom',due_date:'2027-02-05'}:{task_id:item.task_id,action:'keep'}),
    ] };
    await client.request(`${root}/reschedule`, 'POST', { ...payload, decisions: [] }, 400);
    await client.request(`${root}/reschedule`, 'POST', { ...payload, actor_id: 999 }, 400);
    await client.request(`${root}/reschedule`, 'POST', payload, 403, { Origin: 'https://untrusted.invalid' });
    await client.request(`${root}/tasks/${manual.id}`, 'PATCH', { description: 'changed after preview', version: manual.version });
    await client.request(`${root}/reschedule`, 'POST', payload, 409);
    assert.deepEqual((await json(root)).dates, ['2027-01-01']);
    preview = (await json(`${root}/schedule-preview`, 'POST', { dates: ['2027-02-01'] })).preview;
    payload = { ...payload, preview_token: preview.preview_token };
    await client.request(root, 'PATCH', { venue: 'changed elsewhere' });
    const result = await json(`${root}/reschedule`, 'POST', payload);
    assert.equal(result.history.updated_task_ids.length, 2);
    assert.deepEqual(result.history.old_dates, ['2027-01-01']);
    assert.deepEqual((await json(root)).dates, ['2027-02-01']);
    assert.equal((await json(root)).venue, 'changed elsewhere');
    assert.equal((await json(`${root}/tasks/${generated.id}`)).task.status, 'DONE');
    assert.equal((await json(`${root}/tasks/${generated.id}`)).task.due_date, '2027-01-02');
    assert.equal((await json(`${root}/tasks/${manual.id}`)).task.due_date, '2027-02-05');
    assert.equal((await json(`${root}/reschedule`, 'POST', payload)).replayed, true);
    const history = (await json(`${root}/schedule-history`)).history;
    assert.equal(history.length, 1);
    assert.ok(!JSON.stringify(history).includes('Private'));
    await client.request(`${root}/reschedule`, 'POST', { ...payload, decisions: payload.decisions.map((item) => ({ task_id: item.task_id, action: 'keep' })) }, 409);
    await keepSchedule(client, event.id, ['2027-03-01','2027-04-01']);
    assert.equal((await json(`${root}/tasks/${generated.id}`)).task.due_date, '2027-01-02');
    const next = (await json(`${root}/schedule-preview`, 'POST', { dates: ['2027-05-01','2027-06-01'], base_date: '2027-06-01' })).preview;
    assert.equal(next.items.find((item) => item.task_id === generated.id).proposed_due_date, '2027-05-02');
    await client.request(root, 'PATCH', { dates: ['2027-03-01','2027-04-01'], venue: 'ordinary edit still works' });
    console.log('PASS: schedule preview/approval, explicit per-task decisions, completed/custom deadlines, concurrency, atomic updates, replay protection, history and direct-date-edit guard');
  } finally {
    if (event) await client.request(`/api/seminars/${event.id}`, 'DELETE');
    const { templates } = await json('/api/task-templates');
    const current = templates.find((item) => item.id === template.id);
    await client.request(`/api/task-templates/${template.id}`, 'PATCH', { active: false, version: current.version });
  }
}
