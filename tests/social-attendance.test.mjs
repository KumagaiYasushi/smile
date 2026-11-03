import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import {parseSocialAttendance,socialAttendanceCandidates} from '../types/social-attendance.ts';
import {parseSocialGathering,emptySocialPlan,emptySocialGathering,mergeSocialGathering} from '../types/social-gathering.ts';
import {resolveSocialAttendance} from '../lib/social-attendance.ts';
import {createSocietyMemberStore} from '../lib/society-members.ts';
const person={key:'society-1',role:'SOCIETY_LECTURER',member_id:1,name:'選択名',facility:'',response:'ATTENDING'};
const external={status:'YES',id:20,name:'外部講師の記録名',facility:'施設の記録名'};
const make=(attendees,id='plan-1')=>({...emptySocialPlan('ON_DAY',id),attendees});
const social=plans=>({...emptySocialGathering(),status:'HELD',timings:['ON_DAY'],gatherings:plans});
test('social attendance stores independent answers and multiple other guests, preserving unanswered and hidden plans',()=>{
  const other={key:'other-1',role:'OTHER',member_id:null,name:'自由入力',facility:'',response:null};
  const data=parseSocialGathering(social([make([person,other,{...other,key:'other-2',name:'2人目',response:'ABSENT'}]),make([{...person,response:'ABSENT'}],'plan-2')]));
  assert.equal(data.gatherings[0].attendees[0].response,'ATTENDING');assert.equal(data.gatherings[1].attendees[0].response,'ABSENT');assert.equal(data.gatherings[0].attendees[1].response,null);
  const hidden=mergeSocialGathering(data,{status:'NOT_HELD'});assert.deepEqual(hidden.gatherings,data.gatherings);
  assert.equal(mergeSocialGathering(hidden,{fee:3000}).gatherings[0].attendees.length,3);
  for(const patch of [{response:'AM_ONLY'},{name:'   '},{member_id:-1},{role:'admin'},{actor_id:1},{key:'bad key'}])assert.throws(()=>parseSocialAttendance([{...person,...patch}]),{status:400});
  assert.throws(()=>parseSocialAttendance([person,{...person,key:'duplicate-person'}]),{status:400});
  assert.throws(()=>parseSocialAttendance([person,person]),{status:400});
  assert.throws(()=>parseSocialAttendance(Array(1001).fill(person)),{status:400});
});
test('new directory choices resolve server snapshots and archived saved guests retain names and answers',()=>{
  const db=new Database(':memory:');try{
    const directory=createSocietyMemberStore(db),member=directory.list().find(p=>p.role==='SOCIETY_LECTURER');
    const supplied={...person,member_id:member.id,name:'偽の氏名'};
    const guest={key:'external-20',role:'EXTERNAL_LECTURER',member_id:20,name:'偽の外部講師',facility:'偽の施設',response:null};
    const saved=resolveSocialAttendance(db,parseSocialGathering(social([make([supplied,guest])])),external);
    assert.equal(saved.gatherings[0].attendees[0].name,member.name);assert.equal(saved.gatherings[0].attendees[1].name,external.name);
    db.prepare('UPDATE society_members SET name=?,active=0 WHERE id=?').run('改名後',member.id);
    const edited=structuredClone(saved);edited.gatherings[0].attendees[0].name='改変名';edited.gatherings[0].attendees[0].response='ABSENT';
    const result=resolveSocialAttendance(db,edited,{...external,status:'NO'},saved);
    assert.equal(result.gatherings[0].attendees[0].name,member.name);assert.equal(result.gatherings[0].attendees[0].response,'ABSENT');
    assert.throws(()=>resolveSocialAttendance(db,social([make([supplied])]),external),{status:400});
    assert.throws(()=>resolveSocialAttendance(db,social([make([guest])]),{...external,id:999}),{status:400});
    assert.throws(()=>resolveSocialAttendance(db,social([make([{...supplied,role:'SOCIETY_SUPPORT'}])]),external),{status:400});
    const candidates=socialAttendanceCandidates(result.gatherings[0].attendees,directory.list(),external);
    assert.equal(candidates.filter(p=>p.member_id===member.id&&p.role==='SOCIETY_LECTURER').length,1);
    assert.equal(candidates.find(p=>p.member_id===member.id&&p.role==='SOCIETY_LECTURER').name,member.name);
  }finally{db.close();}
});
