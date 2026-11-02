import assert from 'node:assert/strict';
import {emptySocialGathering,emptySocialPlan} from '../types/social-gathering.ts';
export async function smokeSocialAttendance(client){
  const json=async(...args)=>(await client.request(...args)).json(),ids=[];
  const members=(await json('/api/society-members')).members;
  const teacher=members.find(p=>p.active&&p.role==='SOCIETY_LECTURER'),support=members.find(p=>p.active&&p.role==='SOCIETY_SUPPORT');
  const guest=(await json('/api/external-lecturers')).lecturers.find(p=>p.active);
  const attendees=[teacher,support].map(p=>({key:`society-${p.id}`,role:p.role,member_id:p.id,name:'クライアントの変更名',facility:'',response:p===teacher?'ATTENDING':'ABSENT'}));
  attendees.push({key:`external-${guest.id}`,role:'EXTERNAL_LECTURER',member_id:guest.id,name:'変更名',facility:'変更施設',response:null},{key:'other-1',role:'OTHER',member_id:null,name:'非公開の同伴者1',facility:'',response:'ATTENDING'},{key:'other-2',role:'OTHER',member_id:null,name:'非公開の同伴者2',facility:'',response:'ABSENT'});
  const social={...emptySocialGathering(),status:'HELD',timings:['BEFORE','AFTER'],gatherings:[{...emptySocialPlan('BEFORE','first'),attendees},{...emptySocialPlan('AFTER','second'),attendees:attendees.map(p=>({...p,response:null}))}]};
  try{
    for(const event_type of ['BASIC_COURSE','LECTURE','SEMINAR','OTHER']){
      const event=await json('/api/seminars','POST',{name:'懇親会の出欠検証',event_type,occurrence_type:'SINGLE',external_lecturer:{status:'YES',id:guest.id},social_gathering:social},201);ids.push(event.id);
      const root=`/api/seminars/${event.id}`,saved=(await json(root)).social_gathering;
      assert.equal(saved.gatherings[0].attendees.length,5);assert.equal(saved.gatherings[0].attendees[0].name,teacher.name);assert.equal(saved.gatherings[0].attendees[2].name,guest.name);assert.equal(saved.gatherings[0].attendees[2].facility,guest.facility);assert.equal(saved.gatherings[1].attendees[0].response,null);
      const edited=structuredClone(saved);edited.gatherings[0].attendees[0].response='ABSENT';edited.gatherings[0].attendees[0].name='改変名';
      const changed=await json(root,'PATCH',{social_gathering:edited,external_lecturer:{status:'NO'}});assert.equal(changed.social_gathering.gatherings[0].attendees[0].response,'ABSENT');assert.equal(changed.social_gathering.gatherings[0].attendees[0].name,teacher.name);assert.equal(changed.social_gathering.gatherings[1].attendees[0].response,null);
      assert.equal(changed.social_gathering.gatherings[0].participants,null);
      const outline=await json(`${root}/outline`);assert.ok(!JSON.stringify(outline).includes('非公開の同伴者'));
      for(const patch of [{response:'AM_ONLY'},{member_id:-1},{name:'  '},{actor_id:1},{role:'unknown'}]){
        const invalid=structuredClone(edited);Object.assign(invalid.gatherings[0].attendees[0],patch);await client.request(root,'PATCH',{social_gathering:invalid},400);
      }
      await client.request(root,'PATCH',{social_gathering:edited},403,{Origin:'https://untrusted.invalid'});
      assert.equal((await json(root)).social_gathering.gatherings[0].attendees[0].response,'ABSENT');
      const before=(await json('/api/seminars')).length;
      const invalid=structuredClone(social);invalid.gatherings[0].attendees[0].member_id=99999999;
      await client.request('/api/seminars','POST',{name:'不正名簿で取消',event_type,occurrence_type:'SINGLE',external_lecturer:{status:'YES',id:guest.id},social_gathering:invalid},400);
      assert.equal((await json('/api/seminars')).length,before);
    }
    console.log('PASS: per-gathering attendance for four roles/all event types, multiple other guests, server snapshots, independent/unanswered responses, saved guest retention, private outline exclusion, validation, rollback and CSRF');
  }finally{for(const id of ids)await client.request(`/api/seminars/${id}`,'DELETE');}
}
