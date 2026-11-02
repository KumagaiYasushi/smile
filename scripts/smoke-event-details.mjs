import assert from 'node:assert/strict';
import {emptySocialGathering,emptySocialPlan} from '../types/social-gathering.ts';
export async function smokeEventDetails(client) {
  const json=async(...args)=>(await client.request(...args)).json(),ids=[],dates=['2027-11-01','2027-11-08'];
  const directory=(await json('/api/society-members')).members;
  const lecturer=directory.find(p=>p.active&&p.role==='SOCIETY_LECTURER'),support=directory.find(p=>p.active&&p.role==='SOCIETY_SUPPORT');
  try{
    for(const event_type of ['BASIC_COURSE','LECTURE','SEMINAR']) {
      const gatherings=['BEFORE','ON_DAY','AFTER'].map((timing,index)=>({...emptySocialPlan(timing,`party-${index}`),start_at:`2027-11-${String(index+1).padStart(2,'0')}T18:00`,venue:`架空店${index}`,budget:index*10000,participants:index===0?0:index*10}));
      const social={...emptySocialGathering(),status:'HELD',timings:['BEFORE','ON_DAY','AFTER'],gatherings};
      const attendance=[lecturer,support].map(p=>({member_id:p.id,member_version:p.version,version:0,responses:{[dates[0]]:p===lecturer?'AM_ONLY':'PM_ONLY',[dates[1]]:'ABSENT'}}));
      const event=await json('/api/seminars','POST',{name:'架空の出欠・対象・懇親会検証',event_type,occurrence_type:'MULTIPLE',dates,social_gathering:social,registration:{schedule:dates,attendance,lunch:[]}},201);
      ids.push(event.id);const path=`/api/seminars/${event.id}`;
      assert.deepEqual(event.audience_roles,['dental_hygienist','dentist','other']);assert.equal(event.target_participants,'歯科衛生士・歯科医師・その他');
      assert.deepEqual(event.social_gathering.gatherings,gatherings);
      const counts=(await json(`${path}/lunch`)).defaults;assert.equal(counts[dates[0]].LECTURER,1);assert.equal(counts[dates[0]].SUPPORT,1);assert.equal(counts[dates[1]].LECTURER,0);
      const unchanged=await json(path,'PATCH',{notes:'他の項目を変更'});assert.deepEqual(unchanged.social_gathering,event.social_gathering);assert.deepEqual(unchanged.audience_roles,event.audience_roles);
      const selected=await json(path,'PATCH',{audience_roles:['dentist']});assert.equal(selected.target_participants,'歯科医師');
      for(const value of [[],['dentist','dentist'],['bad'],null])await client.request(path,'PATCH',{audience_roles:value},400);
      await client.request(path,'PATCH',{target_participants:[]},400);
      await client.request('/api/seminars','POST',{name:'不正な対象',occurrence_type:'SINGLE',target_participants:1},400);
      const legacy=await json(path,'PATCH',{target_participants:'従来の自由記載対象'});assert.equal(legacy.audience_roles,null);assert.equal(legacy.target_participants,'従来の自由記載対象');
      const scoped=await json(path,'PATCH',{social_gathering:{timings:['ON_DAY']}});assert.equal(scoped.social_gathering.venue,'架空店1');assert.deepEqual(scoped.social_gathering.gatherings,gatherings);
      const oldPatch=await json(path,'PATCH',{social_gathering:{venue:'当日のみ変更'}});assert.equal(oldPatch.social_gathering.gatherings[1].venue,'当日のみ変更');assert.equal(oldPatch.social_gathering.gatherings[0].venue,'架空店0');
      for(const bad of [{timings:['bad']},{gatherings:[{...gatherings[0],budget:-1}]},{gatherings:[{...gatherings[0],participants:1.5}]}])await client.request(path,'PATCH',{name:'保存されない変更',social_gathering:bad},400);
      assert.equal((await json(path)).name,event.name);
      await client.request(path,'PATCH',{social_gathering:social},403,{Origin:'https://untrusted.invalid'});
      const staff=await json(`${path}/staff-attendance`),row=staff.roster.rows.find(p=>p.member_id===lecturer.id);
      await json(`${path}/staff-attendance/roster`,'POST',{member_id:row.member_id,member_version:row.member_version,version:row.version,date:dates[1],response:'PM_ONLY',schedule:dates});
      const restored=await json(`${path}/staff-attendance`);assert.equal(restored.roster.rows.find(p=>p.member_id===lecturer.id).responses[dates[0]],'AM_ONLY');
    }
    console.log('PASS: half-day attendance and lunch defaults, selected audiences/default-all/legacy text, independent social plans/budgets/counts, retained unchecked plans, validation, rollback and CSRF for all event types');
  }finally{for(const id of ids)await client.request(`/api/seminars/${id}`,'DELETE');}
}
