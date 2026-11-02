import assert from 'node:assert/strict';
import {meetingSubmission} from '../types/meeting.ts';
export async function smokeMeetingsHome(client) {
  const json=async(...args)=>(await client.request(...args)).json(),ids=[];
  const people=(await json('/api/society-members')).members.filter(p=>p.active);
  const attendees=people.map(p=>({member_id:p.id,member_version:p.version,response:p.role==='SOCIETY_LECTURER'?'ATTENDING':'PM_ONLY'}));
  const input={title:'架空の打ち合わせ',date:'2027-04-01',time:'10:30',method:'ONLINE',attendees};
  try{
    for(const event_type of ['BASIC_COURSE','LECTURE','SEMINAR','OTHER']){
      const event=await json('/api/seminars','POST',{name:`架空の予定 ${event_type}`,event_type,occurrence_type:'SINGLE',dates:['2027-06-01'],external_payment:{travel:3000,honorarium:50000},registration:{schedule:['2027-06-01'],attendance:[],lunch:[],meetings:[{action:'create',data:input},{action:'create',data:{...input,date:'2027-05-01',time:null,method:'OTHER'}}]}},201);
      ids.push(event.id);const path=`/api/seminars/${event.id}`,root=`${path}/meetings`;
      assert.deepEqual(event.external_payment,{travel:3000,honorarium:50000});
      const data=await json(root);assert.equal(data.meetings.length,2);assert.equal(data.meetings[0].attendees[0].response,attendees[0].response);
      await client.request(`/seminars/${event.id}/meetings`);
      const first=data.meetings[0];
      const changed=await json(root,'POST',{changes:[{action:'update',id:first.id,version:first.version,data:{...meetingSubmission(first),method:'ONSITE'}}]});
      assert.equal(changed.meetings[0].method,'ONSITE');assert.equal(changed.meetings[1].version,1);
      await client.request(root,'POST',{changes:[{action:'delete',id:first.id,version:first.version}]},409);
      await client.request(root,'POST',{changes:[]},403,{Origin:'https://untrusted.invalid'});
      await client.request(root,'POST',{changes:[{action:'create',data:{...input,date:'2027-02-30'}}]},400);
      await client.request(path,'PATCH',{name:'戻される変更',external_payment:{travel:100,honorarium:200},registration:{schedule:['2027-06-01'],attendance:[],lunch:[],meetings:[{action:'create',data:input},{action:'delete',id:first.id,version:first.version}]}},409);
      const same=await json(path);assert.equal(same.name,event.name);assert.deepEqual(same.external_payment,event.external_payment);assert.equal((await json(root)).meetings.length,2);
      for(const external_payment of [{travel:-1,honorarium:0},{travel:0,honorarium:1.5},{travel:'1',honorarium:0}])await client.request(path,'PATCH',{external_payment},400);
      assert.deepEqual((await json(path,'PATCH',{external_payment:{travel:0,honorarium:null}})).external_payment,{travel:0,honorarium:null});
      const rows=(await json('/api/home')).rows.filter(p=>p.event_id===event.id);
      assert.deepEqual(rows.map(p=>p.kind),['MEETING','MEETING',event_type]);assert.equal(rows[0].event_name,event.name);assert.equal(rows[0].date,input.date);
      if(ids.length>1)await client.request(`/api/seminars/${ids[0]}/meetings`,'POST',{changes:[{action:'delete',id:first.id,version:2}]},404);
    }
    await client.request('/home');assert.equal((await client.request('/api/home')).headers.get('cache-control'),'no-store');
    console.log('PASS: event/meeting atomic saves, three meeting methods and independent attendance, edits/scope/version/CSRF/rollback, lecturer amounts and HOME for all four event types');
  }finally{for(const id of ids)await client.request(`/api/seminars/${id}`,'DELETE');}
}
