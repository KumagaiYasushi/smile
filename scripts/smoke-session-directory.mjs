import assert from 'node:assert/strict';
export async function smokeSessionDirectory(client) {
  const json=async(...args)=>(await client.request(...args)).json();
  const directory='/api/society-members';
  const initial=await json(directory);
  assert.equal(initial.members.filter(p=>p.role==='SOCIETY_LECTURER').length,6);
  assert.equal(initial.members.filter(p=>p.role==='SOCIETY_SUPPORT').length,4);
  await client.request(directory,'POST',{name:'bad',role:'EXTERNAL_LECTURER',active:true},400);
  await client.request(directory,'POST',{name:'bad',role:'SOCIETY_LECTURER',active:true},403,{Origin:'https://untrusted.invalid'});
  let member=await json(directory,'POST',{name:'架空の名簿検証講師',role:'SOCIETY_LECTURER',active:true},201);
  const body={name:member.name,role:member.role,active:false,version:member.version};
  member=await json(`${directory}/${member.id}`,'PATCH',body);
  assert.equal(member.active,false);
  await client.request(`${directory}/${member.id}`,'PATCH',body,409);
  await client.request(`${directory}/${member.id}`,'PATCH',{...body,version:member.version},403,{Origin:'https://untrusted.invalid'});
  assert.equal((await client.request(directory)).headers.get('cache-control'),'no-store');
  const ids=[];
  try {
    for(const event_type of ['BASIC_COURSE','LECTURE','SEMINAR']) {
      const dates=['2027-09-01','2027-09-08'];
      const event=await json('/api/seminars','POST',{name:'架空の各回検証',event_type,occurrence_type:'MULTIPLE',dates,delivery_method:'ONLINE',session_delivery_methods:{[dates[0]]:'ONSITE',[dates[1]]:'ONLINE'},repeat_fees:{dentist:550,dental_hygienist:null,other:0},fee_dentist:10001,generate_tasks:false},201);
      ids.push(event.id);const path=`/api/seminars/${event.id}`;
      assert.equal(event.fee_dentist,10001);assert.equal(event.repeat_fees.dentist,550);assert.equal(event.session_delivery_methods[dates[0]],'ONSITE');
      const saved=await json(path,'PATCH',{notes:'他の設定維持'});assert.deepEqual(saved.repeat_fees,event.repeat_fees);assert.deepEqual(saved.session_delivery_methods,event.session_delivery_methods);
      await client.request(path,'PATCH',{session_delivery_methods:{[dates[0]]:'bad'}},400);
      await client.request(path,'PATCH',{session_delivery_methods:{'2027-09-09':'ONSITE'}},400);
      await client.request(path,'PATCH',{repeat_fees:{dentist:-1}},400);
      assert.deepEqual((await json(path)).repeat_fees,event.repeat_fees);
    }
    console.log('PASS: initial six/four-name directory, edits/archive/version/CSRF guards and per-session methods/repeat fees for every event type');
  } finally {for(const id of ids)await client.request(`/api/seminars/${id}`,'DELETE');}
}
