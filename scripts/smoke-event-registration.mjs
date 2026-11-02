import assert from 'node:assert/strict';
import {emptyLunch} from '../types/lunch.ts';
export async function smokeEventRegistration(client) {
  const json=async(...args)=>(await client.request(...args)).json();
  const dates=['2027-11-01','2027-11-08'];
  const members=(await json('/api/society-members')).members.filter(p=>p.active);
  const lecturer=members.find(p=>p.role==='SOCIETY_LECTURER'),support=members.find(p=>p.role==='SOCIETY_SUPPORT');
  const attendance=[lecturer,support].map(p=>({member_id:p.id,member_version:p.version,version:0,responses:{[dates[0]]:p===lecturer?'AM_ONLY':'PM_ONLY',[dates[1]]:'UNANSWERED'}}));
  const registration={schedule:dates,attendance,lunch:[{action:'create',data:{...emptyLunch(),date:dates[0],target:'EXTERNAL_LECTURER',quantity:2,unit_price:900,shop_name:'架空の登録時店舗'}}]};
  const ids=[];
  const template=(await json('/api/task-templates','POST',{event_type:'SEMINAR',title:'登録一括検証用タスク',relative_days:-1},201)).template;
  try {
    const before=(await json('/api/seminars')).length;
    await client.request('/api/seminars','POST',{name:'全体を戻す',occurrence_type:'MULTIPLE',dates,task_base_date:dates[0],registration:{...registration,lunch:[{action:'create',data:{...emptyLunch(),quantity:-1}}]}},400);
    assert.equal((await json('/api/seminars')).length,before);
    for(const event_type of ['BASIC_COURSE','LECTURE','SEMINAR']) {
      const event=await json('/api/seminars','POST',{name:'架空の出欠昼食一括登録',event_type,occurrence_type:'MULTIPLE',dates,task_base_date:dates[0],registration},201);ids.push(event.id);
      const path=`/api/seminars/${event.id}`;
      let staff=await json(`${path}/staff-attendance`),food=await json(`${path}/lunch`);
      assert.equal(staff.people.length,2);assert.equal(food.plans.length,1);assert.equal(food.plans[0].quantity,2);
      assert.equal(staff.roster.rows.find(p=>p.member_id===lecturer.id).responses[dates[0]],'AM_ONLY');
      const person=staff.roster.rows.find(p=>p.member_id===lecturer.id),plan=food.plans[0];
      const patch={schedule:dates,attendance:[{member_id:person.member_id,member_version:person.member_version,version:person.version,responses:{[dates[0]]:'ABSENT'}}],lunch:[{action:'update',id:plan.id,version:plan.version,data:{...emptyLunch(),date:dates[0],quantity:4,unit_price:900}},{action:'create',data:{...emptyLunch(),target:'SUPPORT',quantity:1,unit_price:700}}]};
      await client.request(path,'PATCH',{registration:patch},403,{Origin:'https://untrusted.invalid'});
      await json(path,'PATCH',{notes:'一括変更',registration:patch});
      staff=await json(`${path}/staff-attendance`);food=await json(`${path}/lunch`);
      assert.equal(staff.roster.rows.find(p=>p.member_id===lecturer.id).responses[dates[0]],'ABSENT');assert.equal(food.plans.length,2);assert.equal(food.plans[0].quantity,4);
      await client.request(path,'PATCH',{name:'保存されない名称',registration:patch},409);
      assert.equal((await json(path)).name,event.name);
      await json(`${path}/lunch`,'POST',{...emptyLunch(),target:'PARTICIPANT',quantity:5,schedule:dates},201);
      await json(path,'PATCH',{notes:'出欠・昼食を触らず保存'});assert.equal((await json(`${path}/lunch`)).plans.length,3);
    }
    console.log('PASS: registration-form attendance/lunch for all event types, atomic create/edit, rollback, conflicts, CSRF and later additions');
  } finally {
    for(const id of ids)await client.request(`/api/seminars/${id}`,'DELETE');
    const current=(await json('/api/task-templates')).templates.find(p=>p.id===template.id);
    if(current)await client.request(`/api/task-templates/${current.id}`,'PATCH',{active:false,version:current.version});
  }
}
