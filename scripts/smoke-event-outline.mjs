import assert from 'node:assert/strict';
export async function smokeEventOutline(client){
  const json=async(...args)=>(await client.request(...args)).json(),ids=[];
  try{
    for(const event_type of ['BASIC_COURSE','LECTURE','SEMINAR','OTHER']){
      const event=await json('/api/seminars','POST',{name:`開催要項の架空検証 ${event_type}`,event_type,occurrence_type:'MULTIPLE',dates:['2027-06-01','2027-06-08'],delivery_method:'ONLINE',session_delivery_methods:{'2027-06-01':'ONLINE','2027-06-08':'ONLINE'},event_times:{'2027-06-01':{start:'09:30',end:'16:30'}},venue:'公開しない配信拠点',venue_fee:98765,external_payment:{travel:87654,honorarium:76543},content:'WEB掲載用の内容',notes:'公開しない内部メモ',fee_dentist:10000,fee_dental_hygienist:5000,repeat_fees:{dentist:500,dental_hygienist:null,other:0}},201);ids.push(event.id);
      const root=`/api/seminars/${event.id}`,outline=await json(`${root}/outline`);
      assert.equal(outline.name,event.name);assert.equal(outline.venue,null);assert.match(outline.schedule[0].when,/09:30/);assert.equal(outline.repeat_fees[1].amount,500);
      const serialized=JSON.stringify(outline);for(const privateText of ['公開しない','98765','87654','76543','external_payment','notes'])assert.ok(!serialized.includes(privateText));
      await client.request(`/seminars/${event.id}/outline`);
      const pdf=await client.request(`${root}/outline/pdf`),bytes=Buffer.from(await pdf.arrayBuffer());
      assert.equal(pdf.headers.get('content-type'),'application/pdf');assert.equal(pdf.headers.get('cache-control'),'no-store');assert.match(pdf.headers.get('content-disposition'),/attachment;.*filename\*=UTF-8''/);assert.match(bytes.subarray(0,8).toString(),/^%PDF-/);assert.ok(bytes.subarray(-30).toString().includes('%%EOF'));
      await json(root,'PATCH',{name:'編集後の開催要項',content:'編集後の内容'});assert.equal((await json(`${root}/outline`)).content,'編集後の内容');
    }
    for(const suffix of ['outline','outline/pdf']){await client.request(`/api/seminars/999999/${suffix}`,'GET',undefined,404);await client.request(`/api/seminars/bad/${suffix}`,'GET',undefined,400);}
    console.log('PASS: protected publication outline/PDF for all four event types, Japanese PDF headers, online venue exclusion, private-field exclusion, latest edits, scope and download headers');
  }finally{for(const id of ids)await client.request(`/api/seminars/${id}`,'DELETE');}
}
