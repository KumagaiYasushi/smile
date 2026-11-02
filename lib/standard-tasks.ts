import type Database from 'better-sqlite3';
import {createTaskStore} from './tasks.ts';
import {TaskError} from '../types/task.ts';
export const STANDARD_TASKS=[
  {key:'invitation',title:'外部講師への依頼状',external:true},
  {key:'biography',title:'外部講師への略歴の依頼',external:true},
  {key:'photo',title:'外部講師へのプロフィール写真の依頼',external:true},
  {key:'abstract_300',title:'外部講師への抄録300文字の依頼',external:true},
  {key:'abstract_800',title:'外部講師への抄録800文字の依頼',external:true},
  {key:'participant_confirmation',title:'参加者への確認メール',external:false},
] as const;
export function createStandardTaskStore(db:Database.Database){
  const tasks=createTaskStore(db);
  db.exec(`CREATE TABLE IF NOT EXISTS event_standard_tasks(seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,task_key TEXT NOT NULL,task_id INTEGER REFERENCES event_tasks(id) ON DELETE SET NULL,actor_id INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),PRIMARY KEY(seminar_id,task_key));`);
  return {initialize(seminarId:number,actorId:number){return db.transaction(()=>{
    if(!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId))throw new TaskError('有効な運営メンバーとしてログインしてください',403);
    const event=db.prepare('SELECT * FROM seminars WHERE id=?').get(seminarId) as {external_lecturer?:string;lecturer_role?:string;lecturer_name?:string}|undefined;
    if(!event)throw new TaskError('イベントが見つかりません',404);
    const guest=event.external_lecturer?JSON.parse(event.external_lecturer) as {status:string}:null;
    const external=guest?.status==='YES'||((!guest||guest.status==='UNDECIDED')&&event.lecturer_role==='EXTERNAL_LECTURER'&&!!event.lecturer_name);
    let created=0;
    for(const definition of STANDARD_TASKS.filter(task=>!task.external||external)){
      // Keep the marker after task deletion so later saves do not resurrect it.
      if(db.prepare('SELECT task_key FROM event_standard_tasks WHERE seminar_id=? AND task_key=?').get(seminarId,definition.key))continue;
      const existing=tasks.listTasks(seminarId).find(task=>task.title===definition.title);
      const task=existing??tasks.createTask(seminarId,{title:definition.title},actorId);if(!existing)created++;
      db.prepare('INSERT INTO event_standard_tasks(seminar_id,task_key,task_id,actor_id) VALUES(?,?,?,?)').run(seminarId,definition.key,task.id,actorId);
    }
    return {created};
  }).immediate();}};
}
