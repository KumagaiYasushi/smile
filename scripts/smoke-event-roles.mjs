import assert from 'node:assert/strict';
import {emptyRoleAssignments,EVENT_ROLES} from '../types/event-roles.ts';
import {emptyLunch} from '../types/lunch.ts';
export async function smokeEventRoles(client){const json=async(...args)=>(await client.request(...args)).json(),ids=[];
  const members=(await json('/api/society-members')).members,teacher=members.find(p=>p.active&&p.role==='SOCIETY_LECTURER'),support=members.find(p=>p.active&&p.role==='SOCIETY_SUPPORT');const person=p=>({member_id:p.id,member_version:p.version});
  const roles={version:0,assignments:Object.fromEntries(Object.keys(EVENT_ROLES).map(key=>[key,[person(teacher),person(support)]]))};
  try{for(const event_type of ['BASIC_COURSE','LECTURE','SEMINAR','OTHER']){
    const body={name:'イベント役割の架空検証',event_type,occurrence_type:'SINGLE',registration:{schedule:[],attendance:[],lunch:[],roles}};
    const event=await json('/api/seminars','POST',body,201);ids.push(event.id);const root=`/api/seminars/${event.id}`,path=`${root}/roles`;
    let saved=await json(path);assert.equal(saved.version,1);for(const key of Object.keys(EVENT_ROLES)){assert.equal(saved.assignments[key].length,2);assert.equal(saved.assignments[key][0].name,teacher.name);assert.equal(saved.assignments[key][1].name,support.name);}
    const assignments=structuredClone(roles.assignments);assignments.VENUE=[];assignments.RECEPTION=[person(support)];saved=await json(path,'PUT',{version:1,assignments});assert.equal(saved.version,2);assert.equal(saved.assignments.VENUE.length,0);assert.equal(saved.assignments.RECEPTION.length,1);assert.equal(saved.assignments.CHAIR.length,2);
    await client.request(path,'PUT',{version:1,assignments},409);await client.request(path,'PUT',{version:2,assignments},403,{Origin:'https://untrusted.invalid'});
    for(const invalid of [{version:2,assignments:{...assignments,ADMIN:[]}},{version:2,assignments:{...assignments,WEB:[person(teacher),person(teacher)]}},{version:2,assignments:{...assignments,WEB:[{...person(teacher),name:'偽の氏名'}]}},{version:2,assignments:{...assignments,WEB:[{member_id:9999999,member_version:1}]}}])await client.request(path,'PUT',invalid,400);
    assert.equal((await json(path)).version,2);
    const apiAssignments=structuredClone(roles.assignments);apiAssignments.WEB=[person(teacher)];await json(root,'PATCH',{notes:'役割と同時保存するメモ',registration:{schedule:[],attendance:[],lunch:[],roles:{version:2,assignments:apiAssignments}}});assert.equal((await json(path)).assignments.WEB.length,1);
    await client.request(root,'PATCH',{notes:'失敗時は保存しないメモ',registration:{schedule:[],attendance:[],lunch:[{action:'create',data:{...emptyLunch(),quantity:2,unit_price:500}}],roles:{version:1,assignments}}},409);assert.equal((await json(root)).notes,'役割と同時保存するメモ');assert.equal((await json(`${root}/lunch`)).plans.length,0);
    const outline=await json(`${root}/outline`);assert.ok(!JSON.stringify(outline).includes('assignments'));assert.ok(!JSON.stringify(outline).includes('役割と同時保存するメモ'));
  }
  const other=await json('/api/seminars','POST',{name:'登録後に役割を追加する検証',occurrence_type:'MULTIPLE'},201);ids.push(other.id);assert.equal((await json(`/api/seminars/${other.id}/roles`)).version,0);await json(`/api/seminars/${other.id}/roles`,'PUT',roles);assert.equal((await json(`/api/seminars/${other.id}/roles`)).assignments.MC.length,2);
  await client.request('/api/seminars/99999999/roles','GET',undefined,404);await client.request('/api/seminars/99999999/roles','PUT',{version:0,assignments:emptyRoleAssignments()},404);
  const before=(await json('/api/seminars')).length;await client.request('/api/seminars','POST',{name:'役割不備で取り消す検証',occurrence_type:'SINGLE',registration:{schedule:[],attendance:[],lunch:[],roles:{...roles,assignments:{...roles.assignments,LUNCH:[{member_id:9999999,member_version:1}]}}}},400);assert.equal((await json('/api/seminars')).length,before);
  console.log('PASS: all ten event roles/all four event types, multiple lecturers/supports, dual roles, atomic registration/edit/lunch rollback, later assignment, independent scope, snapshot validation, versions and CSRF');
  }finally{for(const id of ids)await client.request(`/api/seminars/${id}`,'DELETE');}
}
