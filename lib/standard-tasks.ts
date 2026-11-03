import type Database from 'better-sqlite3';
import {createTaskStore} from './tasks.ts';
import {TaskError} from '../types/task.ts';
export const STANDARD_TASKS=[
  {key:'invitation',title:'外部講師への依頼状',external:true},
  {key:'materials',title:'外部講師への資料一括依頼（略歴・写真・抄録300字・800字）',external:true},
  {key:'participant_confirmation',title:'参加者への確認メール',external:false},
] as const;
export function createStandardTaskStore(db:Database.Database){
  const tasks=createTaskStore(db);
  db.exec(`CREATE TABLE IF NOT EXISTS event_standard_tasks(seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,task_key TEXT NOT NULL,task_id INTEGER REFERENCES event_tasks(id) ON DELETE SET NULL,actor_id INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),PRIMARY KEY(seminar_id,task_key));`);
  return {initialize(seminarId:number,actorId:number){return db.transaction(()=>{
    if(!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId))throw new TaskError('有効な運営メンバーとしてログインしてください',403);
    const event=db.prepare('SELECT * FROM seminars WHERE id=?').get(seminarId) as {external_lecturer?:string;lecturer_role?:string;lecturer_name?:string;speakers?:string|null}|undefined;
    if(!event)throw new TaskError('イベントが見つかりません',404);
    const guest=event.external_lecturer?JSON.parse(event.external_lecturer) as {status:string}:null;
    const external=(event.speakers?JSON.parse(event.speakers).some((p:{role:string})=>p.role==='EXTERNAL_LECTURER'):false)||guest?.status==='YES'||((!guest||guest.status==='UNDECIDED')&&event.lecturer_role==='EXTERNAL_LECTURER'&&!!event.lecturer_name);
    const legacy=db.prepare(`SELECT t.* FROM event_standard_tasks m JOIN event_tasks t ON t.id=m.task_id WHERE m.seminar_id=? AND m.task_key IN ('biography','photo','abstract_300','abstract_800')`).all(seminarId) as {id:number;title:string;version:number;status:string;description:string;due_date:string|null;assignee_id:number|null;important:number}[];
    const untouchedTitles=['外部講師への略歴の依頼','外部講師へのプロフィール写真の依頼','外部講師への抄録300文字の依頼','外部講師への抄録800文字の依頼'];
    const mailExists=!!db.prepare("SELECT name FROM sqlite_master WHERE name='event_task_mail'").get();
    const canMerge=legacy.length>0&&legacy.every(t=>t.version===1&&t.status==='NOT_STARTED'&&!t.description&&!t.due_date&&!t.assignee_id&&!t.important&&untouchedTitles.includes(t.title)&&(!mailExists||!db.prepare('SELECT task_id FROM event_task_mail WHERE task_id=?').get(t.id))&&!db.prepare('SELECT task_id FROM task_collaborators WHERE task_id=?').get(t.id));
    let created=0;
    for(const definition of STANDARD_TASKS.filter(task=>!task.external||external)){
      // Keep the marker after task deletion so later saves do not resurrect it.
      if(db.prepare('SELECT task_key FROM event_standard_tasks WHERE seminar_id=? AND task_key=?').get(seminarId,definition.key))continue;
      const existing=tasks.listTasks(seminarId).find(task=>task.title===definition.title);
      const task=existing??tasks.createTask(seminarId,{title:definition.title,...(definition.key==='materials'&&legacy.length===4&&legacy.every(p=>p.status==='DONE')?{status:'DONE'}:{})},actorId);if(!existing)created++;
      db.prepare('INSERT INTO event_standard_tasks(seminar_id,task_key,task_id,actor_id) VALUES(?,?,?,?)').run(seminarId,definition.key,task.id,actorId);
    }
    if(external&&canMerge&&db.prepare("SELECT task_id FROM event_standard_tasks WHERE seminar_id=? AND task_key='materials' AND task_id IS NOT NULL").get(seminarId))for(const task of legacy)tasks.deleteTask(seminarId,task.id,task.version,actorId);
    return {created};
  }).immediate();}};
}
