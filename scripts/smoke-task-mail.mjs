import assert from 'node:assert/strict';
export async function smokeTaskMail(client){const json=async(...args)=>(await client.request(...args)).json();const event=await json('/api/seminars','POST',{name:'依頼文面の架空検証',occurrence_type:'SINGLE'},201);try{const tasks=(await json(`/api/seminars/${event.id}/tasks`)).tasks,task=tasks[0],root=`/api/seminars/${event.id}/tasks/${task.id}/mail`;
  const data=await json(`/api/seminars/${event.id}/tasks`);assert.equal(data.progress.date.length,10);assert.ok(data.progress.text.length<250);assert.deepEqual(data.mail,[]);
  const draft=(await json(root)).mail;assert.equal(draft.phase,'DRAFT');assert.equal(draft.version,0);assert.ok(draft.body.includes(event.name));
  const saved=(await json(root,'PATCH',{to:'lecturer@example.invalid',subject:'依頼の確認',body:'合成データの本文',version:0})).mail;assert.equal(saved.phase,'DRAFT');assert.equal(saved.version,1);
  await client.request(root,'PATCH',{to:'other@example.invalid',subject:'競合',body:'本文',version:0},409);await client.request(root,'PATCH',{to:'invalid\r\nBcc:x@y.invalid',subject:'件名',body:'本文',version:1},400);await client.request(root,'PATCH',{...saved},400);
  const unconfigured=await json('/api/gmail');assert.equal(unconfigured.configured,false);assert.equal(unconfigured.connected,false);assert.ok(!JSON.stringify(unconfigured).includes('token'));
  await client.request('/api/gmail/connect','POST',undefined,503);await client.request(`${root}/send`,'POST',{version:1},503);assert.equal((await json(root)).mail.phase,'DRAFT');
  await client.request(`${root}/send`,'POST',{version:1},403,{Origin:'https://untrusted.invalid'});await client.request('/api/gmail/sync','POST',undefined,403,{Origin:'https://untrusted.invalid'});assert.equal((await json('/api/gmail/sync','POST')).updated,0);
  await client.request('/api/internal/gmail-sync','POST',undefined,503);await client.request('/api/gmail/callback?state=wrong&code=fake','GET',undefined,400);
  const other=await json('/api/seminars','POST',{name:'別イベントのメール',occurrence_type:'SINGLE'},201);try{await client.request(`/api/seminars/${other.id}/tasks/${task.id}/mail`,'GET',undefined,404);}finally{await client.request(`/api/seminars/${other.id}`,'DELETE');}
  console.log('PASS: task draft preview/save, short daily progress, version/scope/validation guards, disabled unconfigured Gmail, state/CSRF/auth protection and no synthetic sends');
}finally{await client.request(`/api/seminars/${event.id}`,'DELETE');}}
