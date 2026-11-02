import assert from 'node:assert/strict';
import {emptyLunch} from '../types/lunch.ts';
export async function smokeFinance(client){
  const json=async(...args)=>(await client.request(...args)).json(),ids=[];
  const guest=(await json('/api/external-lecturers')).lecturers.find(p=>p.active);
  try{for(const event_type of ['BASIC_COURSE','LECTURE','SEMINAR','OTHER']){
    const event=await json('/api/seminars','POST',{name:'収支の架空検証',event_type,occurrence_type:'MULTIPLE',dates:['2027-06-01','2027-06-08'],fee_dentist:10000,fee_dental_hygienist:5000,venue_fee:3000,external_lecturer:{status:'YES',id:guest.id},external_payment:{travel:1000,honorarium:20000}},201);ids.push(event.id);const root=`/api/seminars/${event.id}`,path=`${root}/finance`;
    const initial=await json(path);assert.equal(initial.version,0);assert.equal(initial.estimate.income,'0');assert.equal(initial.estimate.expenses,'24000');
    const p=await json(`${root}/participants`,'POST',{name:'未入金の申込',role:'dentist'},201);assert.equal((await json(path)).estimate.income,'10000');
    await json(`${root}/participants`,'POST',{name:'衛生士申込',role:'dental_hygienist'},201);
    await json(`${root}/lunch`,'POST',{...emptyLunch(),quantity:3,unit_price:1000,date:event.dates[0],schedule:event.dates},201);
    const saved=await json(path,'PATCH',{version:0,sponsorship:30000,participation_adjustment:-1000,other_expenses:500,notes:'非公開の見積もりメモ'});assert.equal(saved.estimate.income,'44000');assert.equal(saved.estimate.expenses,'27500');assert.equal(saved.estimate.balance,'16500');
    await client.request(path,'PATCH',{version:0,sponsorship:1},409);await client.request(path,'PATCH',{version:1,sponsorship:-1},400);await client.request(path,'PATCH',{version:1,actor_id:1},400);await client.request(path,'PATCH',{version:1},403,{Origin:'https://untrusted.invalid'});
    await json(`${root}/participants/${p.id}`,'PATCH',{role:'dental_hygienist'});assert.equal((await json(path)).estimate.participation,'10000');
    assert.ok(!JSON.stringify(await json(`${root}/outline`)).includes('見積もりメモ'));assert.equal((await json(path)).version,1);
    await client.request('/api/seminars/99999999/finance','GET',undefined,404);
  }console.log('PASS: live event estimates for all four types, unpaid applications, role changes, lunch/lecturer/venue costs, sponsorship/discount adjustments, scope, version conflicts, validation, private outline exclusion and CSRF');}
  finally{for(const id of ids)await client.request(`/api/seminars/${id}`,'DELETE');}
}
