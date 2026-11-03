import assert from 'node:assert/strict';
export async function smokeExternalLunch(client) {
  const json=async(...args)=>(await client.request(...args)).json(),directory='/api/external-lecturers';
  const initial=await json(directory);
  assert.deepEqual(initial.lecturers.map(p=>[p.name,p.facility]).sort(),[['長谷剛志','能登総合病院'],['橋本二郎','東京大学生物学講座']].sort());
  await client.request('/external-lecturers');
  const body={name:'架空の外部講師',facility:'架空の勤務施設',active:true};
  await client.request(directory,'POST',body,403,{Origin:'https://untrusted.invalid'});
  let person=await json(directory,'POST',body,201);
  await client.request(directory,'POST',body,409);
  await client.request(`${directory}/${person.id}`,'PATCH',{...body,version:person.version},403,{Origin:'https://untrusted.invalid'});
  const ids=[],date='2027-11-01';
  try{
    for(const event_type of ['BASIC_COURSE','LECTURE','SEMINAR']){
      const event=await json('/api/seminars','POST',{name:'架空の外部講師・昼食検証',event_type,occurrence_type:'SINGLE',dates:[date],session_delivery_methods:{[date]:'ONSITE'},external_lecturer:{status:'YES',id:person.id,name:'forged',facility:'forged'},generate_tasks:false},201);
      ids.push(event.id);const path=`/api/seminars/${event.id}`;
      assert.equal(event.external_lecturer.name,person.name);assert.equal(event.external_lecturer.facility,person.facility);
      for(const [name,role,status]of [['架空講師','SOCIETY_LECTURER','ATTENDING'],['架空サポート','SOCIETY_SUPPORT','ATTENDING'],['架空欠席者','SOCIETY_SUPPORT','ABSENT']])await json(`${path}/staff-attendance`,'POST',{name,role,responses:{[date]:status},schedule:[date]},201);
      for(const name of ['架空参加者A','架空参加者B'])await json(`${path}/participants`,'POST',{name},201);
      const food=await json(`${path}/lunch`);
      assert.deepEqual(food.defaults[date],{LECTURER:1,SUPPORT:1,PARTICIPANT:2,EXTERNAL_LECTURER:1,OTHER:0});
      const order={date,target:'LECTURER',targets:['LECTURER','SUPPORT','PARTICIPANT','EXTERNAL_LECTURER'],quantities:{LECTURER:1,SUPPORT:1,PARTICIPANT:2,EXTERNAL_LECTURER:1},quantity:5,unit_price:900,additional_cost:500,schedule:[date]};
      const plan=(await json(`${path}/lunch`,'POST',order,201)).plan;
      assert.equal(plan.quantity,5);assert.equal(plan.quantity*plan.unit_price+plan.additional_cost,5000);
      await client.request(`${path}/lunch/${plan.id}`,'PATCH',{...order,quantity:6,version:plan.version},400);
      assert.deepEqual((await json(`${path}/lunch`)).plans[0].quantities,order.quantities);
      await json(path,'PATCH',{external_lecturer:{status:'NO'}});
      assert.equal((await json(`${path}/lunch`)).defaults[date].EXTERNAL_LECTURER,0);
      const restored=await json(path,'PATCH',{external_lecturer:{status:'YES',id:person.id}});
      assert.equal(restored.external_lecturer.name,person.name);
    }
    const version=person.version;
    person=await json(`${directory}/${person.id}`,'PATCH',{...body,name:'架空の改名後',facility:'架空の移籍先',active:false,version});
    await client.request(`${directory}/${person.id}`,'PATCH',{...body,version},409);
    const event=await json(`/api/seminars/${ids[0]}`,'PATCH',{external_lecturer:{status:'YES',id:person.id},notes:'別項目の編集'});
    assert.equal(event.external_lecturer.name,body.name);assert.equal(event.external_lecturer.facility,body.facility);
    await client.request('/api/seminars','POST',{name:'利用停止の選択不可',occurrence_type:'SINGLE',external_lecturer:{status:'YES',id:person.id},generate_tasks:false},400);
    assert.equal((await client.request(directory)).headers.get('cache-control'),'no-store');
    console.log('PASS: external lecturer seed/edit/archive/snapshot, auth/CSRF/version and multi-target lunch defaults with attendance/participant counts for all event types');
  }finally{for(const id of ids)await client.request(`/api/seminars/${id}`,'DELETE');}
}
