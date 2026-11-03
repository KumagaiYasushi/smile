import type Database from 'better-sqlite3';
import {createSocietyMemberStore} from './society-members.ts';
import {TaskError} from '../types/task.ts';
import {emptyRoleAssignments,parseRoleAssignments,EVENT_ROLES} from '../types/event-roles.ts';
import type {RoleAssignmentData,RoleAssignments,EventRoleKey} from '../types/event-roles.ts';
export function createEventRoleStore(db:Database.Database){
  db.exec(`CREATE TABLE IF NOT EXISTS event_role_assignments(seminar_id INTEGER PRIMARY KEY REFERENCES seminars(id) ON DELETE CASCADE,assignments_json TEXT NOT NULL CHECK(json_valid(assignments_json)),version INTEGER NOT NULL DEFAULT 1,actor_id INTEGER NOT NULL,updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));CREATE TABLE IF NOT EXISTS event_role_history(id INTEGER PRIMARY KEY AUTOINCREMENT,seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,actor_id INTEGER NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,occurred_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);
  const directory=createSocietyMemberStore(db);
  function read(eventId:number):RoleAssignmentData {if(!db.prepare('SELECT id FROM seminars WHERE id=?').get(eventId))throw new TaskError('イベントが見つかりません',404);const row=db.prepare('SELECT assignments_json,version FROM event_role_assignments WHERE seminar_id=?').get(eventId) as {assignments_json:string;version:number}|undefined;return {assignments:row?JSON.parse(row.assignments_json):emptyRoleAssignments(),version:row?.version??0,members:directory.list()};}
  function snapshot(data:Pick<RoleAssignmentData,'version'|'assignments'>){return JSON.stringify({version:data.version,assignments:Object.fromEntries(Object.entries(data.assignments).map(([role,people])=>[role,people.map(({member_id})=>member_id)]))});}
  return {read,save(eventId:number,value:unknown,actorId:number){return db.transaction(()=>{
    if(!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId))throw new TaskError('有効な運営メンバーとしてログインしてください',403);
    const current=read(eventId),input=parseRoleAssignments(value);if(input.version!==current.version)throw new TaskError('別の操作で役割担当が更新されています。最新の担当を取得してください',409);
    const members=new Map(current.members.map(m=>[m.id,m]));
    const assignments=Object.fromEntries((Object.keys(EVENT_ROLES) as EventRoleKey[]).map(key=>[key,input.assignments[key].map(person=>{
      const saved=current.assignments[key].find(m=>m.member_id===person.member_id);if(saved)return saved;
      const member=members.get(person.member_id);if(!member||!member.active)throw new TaskError('有効な研究会講師・サポートメンバーから選択してください');
      if(member.version!==person.member_version)throw new TaskError('研究会名簿が更新されています。名簿と担当を再取得してください',409);
      return {...person,name:member.name,role:member.role};
    })])) as RoleAssignments;
    db.prepare(`INSERT INTO event_role_assignments(seminar_id,assignments_json,actor_id) VALUES(?,?,?) ON CONFLICT(seminar_id) DO UPDATE SET assignments_json=excluded.assignments_json,version=event_role_assignments.version+1,actor_id=excluded.actor_id,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).run(eventId,JSON.stringify(assignments),actorId);
    const after=read(eventId);db.prepare('INSERT INTO event_role_history(seminar_id,actor_id,before_json,after_json) VALUES(?,?,?,?)').run(eventId,actorId,snapshot(current),snapshot(after));return after;
  }).immediate();}};
}
