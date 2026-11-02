import assert from 'node:assert/strict';

export async function smokeTemplates(client) {
  const json=async(...args)=>(await client.request(...args)).json(),ids=[],templates=[];
  try {
    await client.request('/task-templates');
    await client.request('/api/task-templates?event_type=INVALID','GET',undefined,400);
    await client.request('/api/task-templates','POST',{title:'missing fields'},400);
    await client.request('/api/task-templates','POST',{event_type:'SEMINAR',title:'CSRF',relative_days:0},403,{Origin:'https://untrusted.invalid'});
    for(const event_type of ['BASIC_COURSE','LECTURE','SEMINAR']) {
      let template=(await json('/api/task-templates','POST',{event_type,title:'架空の保存済みテンプレート',relative_days:-30},201)).template;
      templates.push(template.id);
      for(const extra of [{dates:['2027-01-01']},{dates:['2027-01-01','2027-02-01']},{dates:[]},{dates:['2027-01-01'],generate_tasks:true,task_base_date:'2027-01-01'}]) {
        const event=await json('/api/seminars','POST',{name:'テンプレート生成停止の検証',event_type,occurrence_type:'MULTIPLE',...extra},201);
        ids.push(event.id);const root=`/api/seminars/${event.id}/tasks`;
        assert.deepEqual((await json(root)).tasks,[]);
        const manual=(await json(root,'POST',{title:'既存タスクを保持',due_date:'2026-12-02'},201)).task;
        for(const endpoint of ['template-preview','apply-templates']) {
          await client.request(`${root}/${endpoint}`,'POST',{base_date:'2027-01-01',preview_token:'a'.repeat(64)},410);
          await client.request(`${root}/${endpoint}`,'POST',{},403,{Origin:'https://untrusted.invalid'});
        }
        const after=(await json(root)).tasks;assert.equal(after.length,1);assert.equal(after[0].id,manual.id);assert.equal(after[0].version,manual.version);
      }
      const body={relative_days:-7,version:template.version};
      template=(await json(`/api/task-templates/${template.id}`,'PATCH',body)).template;
      await client.request(`/api/task-templates/${template.id}`,'PATCH',body,409);
      const event=await json(`/api/seminars/${ids.at(-1)}`,'PATCH',{notes:'通常のイベント編集'});
      assert.equal((await json(`/api/seminars/${event.id}/tasks`)).tasks.length,1);
    }
    console.log('PASS: generation controls/API disabled for all event types and schedules, legacy generation flags ignored, existing/manual tasks and editable template records preserved, auth/CSRF/version guards');
  } finally {
    for(const id of ids)await client.request(`/api/seminars/${id}`,'DELETE');
    const current=(await json('/api/task-templates')).templates;
    for(const template of current.filter(p=>templates.includes(p.id)&&p.active))await client.request(`/api/task-templates/${template.id}`,'PATCH',{active:false,version:template.version});
  }
}
