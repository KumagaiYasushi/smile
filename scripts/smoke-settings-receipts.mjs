import assert from 'node:assert/strict';
export async function smokeSettingsReceipts(client) {
  const json=async (...args)=>(await client.request(...args)).json();
  const ids=[];
  try {
    await client.request('/api/seminars','POST',{name:'回数未選択'},400);
    for(const event_type of ['BASIC_COURSE','LECTURE','SEMINAR']) {
      await client.request('/api/seminars','POST',{name:'不正な単回',event_type,occurrence_type:'SINGLE',dates:['2027-01-01','2027-02-01']},400);
      const event=await json('/api/seminars','POST',{name:'架空の設定・領収書検証',event_type,occurrence_type:'SINGLE',dates:['2027-01-01'],generate_tasks:false},201);
      ids.push(event.id);
      const path=`/api/seminars/${event.id}`;
      assert.equal(event.occurrence_type,'SINGLE'); assert.deepEqual(event.event_times,{});
      assert.equal((await json(`${path}/lunch`)).plans.length,0);
      await client.request(`${path}/schedule-preview`,'POST',{dates:['2027-01-01','2027-02-01'],base_date:null},400);
      for(const invalid of ['',null,'toString']) await client.request(path,'PATCH',{occurrence_type:invalid},400);
      await client.request(path,'PATCH',{event_times:{'2027-01-01':{start:'24:00'}}},400);
      const updated=await json(path,'PATCH',{event_times:{'2027-01-01':{start:'09:00',end:'16:00'}},lecturer_role:'EXTERNAL_LECTURER'});
      assert.equal(updated.event_times['2027-01-01'].start,'09:00');
      assert.equal(updated.lecturer_role,'EXTERNAL_LECTURER');
      assert.deepEqual((await json(path,'PATCH',{event_times:{}})).event_times,{});
      const participant=await json(`${path}/participants`,'POST',{name:'架空の振込参加者',payment_method:'bank_transfer'},201);
      const pp=`${path}/participants/${participant.id}`;
      await client.request(`${pp}/receipt`,'GET',undefined,404);
      await client.request(`${pp}/receipt`,'POST',undefined,409);
      await client.request(pp,'PATCH',{payment_confirmed_at:'forged'},400);
      await client.request(pp,'PATCH',{payment_status:'paid'},400);
      assert.equal((await json(pp,'PATCH',{payment_status:'paid',paid_amount:8800})).paid_amount,8800);
      await client.request(`${pp}/receipt`,'POST',undefined,403,{Origin:'https://untrusted.invalid'});
      const issued=await json(`${pp}/receipt`,'POST');
      assert.equal(issued.receipt.amount,8800); assert.equal(issued.reused,false);
      assert.equal((await json(`${pp}/receipt`,'POST')).reused,true);
      const read=await client.request(`${pp}/receipt`);
      assert.equal(read.headers.get('cache-control'),'no-store');
      assert.equal((await read.json()).receipt_number,issued.receipt.receipt_number);
      await client.request(pp,'PATCH',{payment_status:'unpaid'},409);
      await client.request(pp,'PATCH',{paid_amount:0},409);
      const receipt=await json(`${pp}/receipt`);
      assert.equal(receipt.participant_name,participant.name);
      await client.request(`/api/seminars/${event.id+999}/participants/${participant.id}/receipt`,'GET',undefined,404);
      await client.request(`/api/seminars/${event.id+999}/participants/${participant.id}/receipt`,'POST',undefined,404);
      const cash=await json(`${path}/participants`,'POST',{name:'架空の現金参加者',payment_method:'cash',payment_status:'paid',paid_amount:5000},201);
      await client.request(`${path}/participants/${cash.id}/receipt`,'POST',undefined,409);
    }
    console.log('PASS: explicit occurrence, optional times, lunch later for all types, confirmed bank-transfer receipts, snapshots, retries, scope and CSRF');
  } finally { for(const id of ids) await client.request(`/api/seminars/${id}`,'DELETE'); }
}
