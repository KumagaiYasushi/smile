import type Database from 'better-sqlite3';
import {TaskError,parseVersion} from '../types/task.ts';
import {parseExternalLecturer,emptyExternal} from '../types/external-lecturer.ts';
import type {ExternalLecturer,ExternalSelection} from '../types/external-lecturer.ts';
export function initExternalLecturers(db:Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS external_lecturers(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,facility TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),version INTEGER NOT NULL DEFAULT 1,UNIQUE(name,facility));
    CREATE TABLE IF NOT EXISTS external_lecturer_history(id INTEGER PRIMARY KEY AUTOINCREMENT,lecturer_id INTEGER NOT NULL REFERENCES external_lecturers(id),actor_id INTEGER NOT NULL,action TEXT NOT NULL,before_json TEXT,after_json TEXT NOT NULL,occurred_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);
}
export const INITIAL_EXTERNAL_LECTURERS=[{name:'長谷剛志',facility:'能登総合病院'},{name:'橋本二郎',facility:'東京大学生物学講座'}];
export function createExternalLecturerStore(db:Database.Database) {
  initExternalLecturers(db);
  db.exec('CREATE TABLE IF NOT EXISTS external_lecturer_seed(id INTEGER PRIMARY KEY CHECK(id=1))');
  db.transaction(()=>{if(db.prepare('SELECT id FROM external_lecturer_seed WHERE id=1').get())return;for(const person of INITIAL_EXTERNAL_LECTURERS)db.prepare('INSERT OR IGNORE INTO external_lecturers(name,facility) VALUES(?,?)').run(person.name,person.facility);db.prepare('INSERT INTO external_lecturer_seed(id) VALUES(1)').run();}).immediate();
  const list=():ExternalLecturer[]=>(db.prepare('SELECT * FROM external_lecturers ORDER BY name,facility,id').all() as (Omit<ExternalLecturer,'active'>&{active:number})[]).map(row=>({...row,active:!!row.active}));
  return {list,save(value:unknown,actorId:number,id?:number) {
    return db.transaction(()=>{
      if(!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId))throw new TaskError('有効な運営メンバーとしてログインしてください',403);
      const data=parseExternalLecturer(value),current=id?list().find(p=>p.id===id):undefined;
      if(id&&!current)throw new TaskError('外来講師が見つかりません',404);
      if(current&&parseVersion((value as {version?:unknown}).version)!==current.version)throw new TaskError('別の操作で更新されています。最新情報を取得してください',409);
      if(db.prepare('SELECT id FROM external_lecturers WHERE name=? AND facility=? AND id!=?').get(data.name,data.facility,id??0))throw new TaskError('同じ氏名・勤務施設が登録されています',409);
      if(current)db.prepare('UPDATE external_lecturers SET name=?,facility=?,active=?,version=version+1 WHERE id=?').run(data.name,data.facility,+data.active,id);
      else id=Number(db.prepare('INSERT INTO external_lecturers(name,facility,active) VALUES(?,?,?)').run(data.name,data.facility,+data.active).lastInsertRowid);
      const after=list().find(p=>p.id===id)!;
      db.prepare('INSERT INTO external_lecturer_history(lecturer_id,actor_id,action,before_json,after_json) VALUES(?,?,?,?,?)').run(id,actorId,current?'updated':'created',current?JSON.stringify({active:current.active,version:current.version}):null,JSON.stringify({active:after.active,version:after.version}));
      return after;
    }).immediate();
  }};
}
export function resolveExternalSelection(db:Database.Database,value:unknown,current:ExternalSelection=emptyExternal()):ExternalSelection {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('外来講師の選択形式が不正です');
  const input=value as Record<string,unknown>;
  if(Object.keys(input).some(key=>!['status','id','name','facility'].includes(key))||!['YES','NO','UNDECIDED'].includes(input.status as string))throw new TaskError('外来講師のあり・なしを選択してください');
  if(input.status!=='YES')return {...current,status:input.status as 'NO'|'UNDECIDED'};
  if(input.id===current.id&&current.name)return {...current,status:'YES'};
  if(typeof input.id!=='number'||!Number.isSafeInteger(input.id)||input.id<1)throw new TaskError('外来講師をリストから選択してください');
  const person=createExternalLecturerStore(db).list().find(p=>p.id===input.id);
  if(!person||!person.active)throw new TaskError('利用中の外来講師をリストから選択してください');
  return {status:'YES',id:person.id,name:person.name,facility:person.facility};
}
