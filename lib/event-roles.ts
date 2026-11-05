import {createStaffRosterStore} from './staff-roster.ts';
import type Database from 'better-sqlite3';
import {createSocietyMemberStore} from './society-members.ts';
import {TaskError} from '../types/task.ts';
import {attendanceDateKeys} from '../types/staff-attendance.ts';
import {emptyRoleAssignments,emptyDayRoles,parseRoleAssignments,EVENT_DAY_ROLES,PREPARATION_ROLES,dayRoleAttendance,aggregateDayRoles} from '../types/event-roles.ts';
import type {RoleAssignmentData,RoleAssignments,EventRoleKey,EventDayRoleKey,DayRoleAssignments,RoleMemberInput,RoleAssignee} from '../types/event-roles.ts';
export function createEventRoleStore(db:Database.Database){
  db.exec(`CREATE TABLE IF NOT EXISTS event_role_assignments(seminar_id INTEGER PRIMARY KEY REFERENCES seminars(id) ON DELETE CASCADE,assignments_json TEXT NOT NULL CHECK(json_valid(assignments_json)),version INTEGER NOT NULL DEFAULT 1,actor_id INTEGER NOT NULL,updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));CREATE TABLE IF NOT EXISTS event_role_history(id INTEGER PRIMARY KEY AUTOINCREMENT,seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,actor_id INTEGER NOT NULL,before_json TEXT NOT NULL,after_json TEXT NOT NULL,occurred_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);
  db.transaction(()=>{if(!(db.prepare('PRAGMA table_info(event_role_assignments)').all() as {name:string}[]).some(p=>p.name==='day_assignments_json'))db.exec('ALTER TABLE event_role_assignments ADD COLUMN day_assignments_json TEXT CHECK(day_assignments_json IS NULL OR json_valid(day_assignments_json))');}).immediate();
  const directory=createSocietyMemberStore(db),roster=createStaffRosterStore(db);
  function read(eventId:number):RoleAssignmentData{
    if(!db.prepare('SELECT id FROM seminars WHERE id=?').get(eventId))throw new TaskError('イベントが見つかりません',404);
    const row=db.prepare('SELECT assignments_json,day_assignments_json,version FROM event_role_assignments WHERE seminar_id=?').get(eventId) as {assignments_json:string;day_assignments_json:string|null;version:number}|undefined;
    const assignments:RoleAssignments=row?JSON.parse(row.assignments_json):emptyRoleAssignments(),attendance=roster.list(eventId),dates=attendanceDateKeys(attendance.dates);
    const days:Record<string,DayRoleAssignments>=row?.day_assignments_json?JSON.parse(row.day_assignments_json):{};
    for(const date of dates)if(!days[date])days[date]=row&&row.day_assignments_json===null?Object.fromEntries(Object.keys(EVENT_DAY_ROLES).map(key=>[key,assignments[key as EventDayRoleKey]])) as DayRoleAssignments:emptyDayRoles();
    return {assignments:aggregateDayRoles(assignments,days,dates),day_assignments:days,version:row?.version??0,members:directory.list(),attendance};
  }
  function snapshot(data:RoleAssignmentData){const ids=(roles:Record<string,RoleAssignee[]>)=>Object.fromEntries(Object.entries(roles).map(([key,people])=>[key,people.map(p=>p.member_id)]));return JSON.stringify({version:data.version,assignments:ids(data.assignments),day_assignments:Object.fromEntries(Object.entries(data.day_assignments??{}).map(([date,roles])=>[date,ids(roles)]))});}
  return {read,save(eventId:number,value:unknown,actorId:number){return db.transaction(()=>{
    if(!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId))throw new TaskError('有効な運営メンバーとしてログインしてください',403);
    const current=read(eventId),input=parseRoleAssignments(value);if(input.version!==current.version)throw new TaskError('別の操作で役割担当が更新されています。最新の担当を取得してください',409);
    const members=new Map(current.members.map(m=>[m.id,m])),dates=attendanceDateKeys(current.attendance!.dates);
    function resolve(person:RoleMemberInput,saved:RoleAssignee|undefined,date?:string):RoleAssignee{
      if(date!==undefined&&dates.includes(date)&&dayRoleAttendance(current.attendance,person.member_id,date).blocked)throw new TaskError(`${date||'日程未定'}に欠席のメンバーは、その日の役割に割り当てできません。担当を解除してください`);
      if(saved)return saved;
      const member=members.get(person.member_id);if(!member||!member.active)throw new TaskError('有効な研究会講師・サポートメンバーから選択してください');
      if(member.version!==person.member_version)throw new TaskError('研究会名簿が更新されています。名簿と担当を再取得してください',409);
      return {...person,name:member.name,role:member.role};
    }
    const assignments={...current.assignments};
    for(const key of Object.keys(PREPARATION_ROLES) as EventRoleKey[])assignments[key]=input.assignments[key].map(p=>resolve(p,current.assignments[key].find(m=>m.member_id===p.member_id)));
    const days={...current.day_assignments};
    const requested=input.day_assignments??Object.fromEntries(dates.map(date=>[date,Object.fromEntries(Object.keys(EVENT_DAY_ROLES).map(key=>[key,input.assignments[key as EventDayRoleKey]])) as Record<EventDayRoleKey,RoleMemberInput[]>]));
    for(const [date,roles] of Object.entries(requested)){
      if(!dates.includes(date)&&!current.day_assignments?.[date])throw new TaskError('登録済みの開催日から当日役割を選択してください');
      days[date]=Object.fromEntries(Object.keys(EVENT_DAY_ROLES).map(key=>{const role=key as EventDayRoleKey;return [role,roles[role].map(p=>resolve(p,current.day_assignments?.[date]?.[role].find(m=>m.member_id===p.member_id),date))];})) as DayRoleAssignments;
    }
    const combined=aggregateDayRoles(assignments,days,dates);
    db.prepare(`INSERT INTO event_role_assignments(seminar_id,assignments_json,day_assignments_json,actor_id) VALUES(?,?,?,?) ON CONFLICT(seminar_id) DO UPDATE SET assignments_json=excluded.assignments_json,day_assignments_json=excluded.day_assignments_json,version=event_role_assignments.version+1,actor_id=excluded.actor_id,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).run(eventId,JSON.stringify(combined),JSON.stringify(days),actorId);
    const after=read(eventId);db.prepare('INSERT INTO event_role_history(seminar_id,actor_id,before_json,after_json) VALUES(?,?,?,?)').run(eventId,actorId,snapshot(current),snapshot(after));return after;
  }).immediate();}};
}
