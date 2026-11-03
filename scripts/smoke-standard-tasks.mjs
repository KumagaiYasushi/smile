import assert from 'node:assert/strict';
import {STANDARD_TASKS} from '../lib/standard-tasks.ts';
export async function smokeStandardTasks(client,db){
  const json=async(...args)=>(await client.request(...args)).json(),ids=[];
  const guest=(await json('/api/external-lecturers')).lecturers.find(p=>p.active);
  try{
    for(const event_type of ['BASIC_COURSE','LECTURE','SEMINAR','OTHER'])for(const external of [false,true]){
      const event=await json('/api/seminars','POST',{name:'基本タスク自動作成',event_type,occurrence_type:'SINGLE',external_lecturer:external?{status:'YES',id:guest.id}:{status:'NO'}},201);ids.push(event.id);
      const root=`/api/seminars/${event.id}`,path=`${root}/tasks`;
      let tasks=(await json(path)).tasks;assert.deepEqual(tasks.map(p=>p.title),STANDARD_TASKS.filter(p=>!p.external||external).map(p=>p.title));
      assert.ok(tasks.every(p=>p.status==='NOT_STARTED'&&p.due_date===null&&p.assignee_id===null));
      const chosen=tasks[0];await json(`${path}/${chosen.id}`,'PATCH',{title:'利用者による変更',status:'DONE',version:chosen.version});
      await json(root,'PATCH',{notes:'通常の保存'});tasks=(await json(path)).tasks;assert.equal(tasks.length,external?3:1);assert.ok(tasks.some(p=>p.title==='利用者による変更'&&p.status==='DONE'));
      const changed=tasks.find(p=>p.id===chosen.id);await client.request(`${path}/${changed.id}`,'DELETE',{version:changed.version});
      assert.equal((await json(`${path}/initialize`,'POST')).created,0);assert.equal((await json(path)).tasks.length,external?2:0);
      await json(path,'POST',{title:'任意の追加タスク'},201);assert.ok((await json(path)).tasks.some(p=>p.title==='任意の追加タスク'));
      await client.request(`${path}/initialize`,'POST',undefined,403,{Origin:'https://untrusted.invalid'});
    }
    // Existing registered events acquire the same defaults when task management opens.
    const old=await json('/api/seminars','POST',{name:'既存イベントの設定確認',occurrence_type:'SINGLE'},201);ids.push(old.id);
    db.prepare('DELETE FROM event_standard_tasks WHERE seminar_id=?').run(old.id);db.prepare('DELETE FROM event_tasks WHERE seminar_id=?').run(old.id);
    assert.equal((await json(`/api/seminars/${old.id}/tasks/initialize`,'POST')).created,1);
    const before=(await json('/api/seminars')).length;
    await client.request('/api/seminars','POST',{name:'保存を取り消すイベント',occurrence_type:'SINGLE',registration:{schedule:[],attendance:[],lunch:[{action:'create',data:{target:'LECTURER',quantity:-1}}]}},400);assert.equal((await json('/api/seminars')).length,before);
    assert.equal(db.prepare('SELECT count(*) n FROM event_standard_tasks WHERE seminar_id NOT IN (SELECT id FROM seminars)').get().n,0);
    console.log('PASS: three/one standard tasks for all types, initial status, repeated saves, renamed/completed/deleted task preservation, arbitrary tasks, legacy setup, CSRF and atomic rollback');
  }finally{for(const id of ids)await client.request(`/api/seminars/${id}`,'DELETE');}
}
