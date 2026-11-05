import type Database from 'better-sqlite3';
import {parseFinance,emptyFinance,buildEventEstimate} from '../types/event-finance.ts';
import {TaskError,parseVersion} from '../types/task.ts';
import {createLunchStore} from './lunch.ts';
import type {Seminar} from '../types/seminar.ts';
import type {Participant} from '../types/participant.ts';
export function createFinanceStore(db:Database.Database){
  db.exec(`CREATE TABLE IF NOT EXISTS event_finance(seminar_id INTEGER PRIMARY KEY REFERENCES seminars(id) ON DELETE CASCADE,input_json TEXT NOT NULL CHECK(json_valid(input_json)),version INTEGER NOT NULL DEFAULT 1,actor_id INTEGER NOT NULL,updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);
  function settings(id:number){const row=db.prepare('SELECT input_json,version FROM event_finance WHERE seminar_id=?').get(id) as {input_json:string;version:number}|undefined;return {settings:row?parseFinance(JSON.parse(row.input_json)):emptyFinance(),version:row?.version??0};}
  function read(event:Seminar){const data=settings(event.id);const people=db.prepare('SELECT role,payment_status,paid_amount FROM participants WHERE seminar_id=?').all(event.id) as Participant[];const lunch=createLunchStore(db).list(event.id).plans;return {...data,estimate:buildEventEstimate(event,people,lunch,data.settings)};}
  return {read,save(event:Seminar,value:unknown,actorId:number){return db.transaction(()=>{
    if(!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId))throw new TaskError('ログインが必要です',403);
    if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('概算の入力形式が不正です');
    const {version,...fields}=value as Record<string,unknown>;const current=settings(event.id);
    if((version===0?0:parseVersion(version))!==current.version)throw new TaskError('別の操作で更新されています。最新の概算を取得してください',409);
    const input=parseFinance({...current.settings,...fields});
    db.prepare(`INSERT INTO event_finance(seminar_id,input_json,actor_id) VALUES(?,?,?) ON CONFLICT(seminar_id) DO UPDATE SET input_json=excluded.input_json,actor_id=excluded.actor_id,version=event_finance.version+1,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).run(event.id,JSON.stringify(input),actorId);
    return read(event);
  }).immediate();}};
}
