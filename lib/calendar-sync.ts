import {createHash,randomUUID} from 'node:crypto';
import type Database from 'better-sqlite3';
import type {CalendarDesired,GoogleScheduleEvent} from '../types/calendar-sync.ts';
import {TaskError} from '../types/task.ts';
export type CalendarGateway={status:()=>{connected:boolean;configured:boolean};upsert:(id:string,event:GoogleScheduleEvent)=>Promise<void>;remove:(id:string)=>Promise<void>};
type Job={key:string;seminar_id:number;google_id:string;payload_json:string|null;version:number;synced_version:number;lease:string|null;lease_until:number;last_error:string|null};
export function createCalendarSyncStore(db:Database.Database){
 db.exec(`CREATE TABLE IF NOT EXISTS calendar_sync_namespace(id INTEGER PRIMARY KEY CHECK(id=1),namespace TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS calendar_sync_jobs(key TEXT PRIMARY KEY,seminar_id INTEGER NOT NULL,google_id TEXT NOT NULL UNIQUE,payload_json TEXT,version INTEGER NOT NULL DEFAULT 1,synced_version INTEGER NOT NULL DEFAULT 0,lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,last_error TEXT,synced_at TEXT);
 CREATE INDEX IF NOT EXISTS calendar_sync_event ON calendar_sync_jobs(seminar_id);
 CREATE TABLE IF NOT EXISTS calendar_dirty_events(seminar_id INTEGER PRIMARY KEY,version INTEGER NOT NULL DEFAULT 1)`);
 db.prepare('INSERT OR IGNORE INTO calendar_sync_namespace(id,namespace) VALUES(1,?)').run(randomUUID());
 const namespace=(db.prepare('SELECT namespace FROM calendar_sync_namespace WHERE id=1').get() as {namespace:string}).namespace;
 function refresh(seminarId:number,desired:CalendarDesired[]){return db.transaction(()=>{
  const keys=new Set<string>();
  for(const item of desired){const key=`${seminarId}/${item.key}`;keys.add(key);const json=JSON.stringify(item.payload),id=createHash('sha256').update(`${namespace}/${key}`).digest('hex');
   db.prepare(`INSERT INTO calendar_sync_jobs(key,seminar_id,google_id,payload_json) VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET payload_json=excluded.payload_json,version=calendar_sync_jobs.version+1,last_error=NULL WHERE calendar_sync_jobs.payload_json IS NOT excluded.payload_json`).run(key,seminarId,id,json);
  }
  const previous=db.prepare('SELECT key FROM calendar_sync_jobs WHERE seminar_id=? AND payload_json IS NOT NULL').all(seminarId) as {key:string}[];
  for(const old of previous)if(!keys.has(old.key))db.prepare('UPDATE calendar_sync_jobs SET payload_json=NULL,version=version+1,last_error=NULL WHERE key=?').run(old.key);
 }).immediate();}
 function pending(){return db.prepare('SELECT key,seminar_id,last_error FROM calendar_sync_jobs WHERE version>synced_version ORDER BY rowid LIMIT 50').all() as {key:string;seminar_id:number;last_error:string|null}[];}
 function status(){return {pending:(db.prepare('SELECT count(*) n FROM calendar_sync_jobs WHERE version>synced_version').get() as {n:number}).n,dirty:(db.prepare('SELECT count(*) n FROM calendar_dirty_events').get() as {n:number}).n,failed:(db.prepare('SELECT count(*) n FROM calendar_sync_jobs WHERE version>synced_version AND last_error IS NOT NULL').get() as {n:number}).n,jobs:pending()};}
 async function dispatch(gateway:CalendarGateway,limit=10){if(!gateway.status().connected||!gateway.status().configured)return {updated:0,attempt_failed:0,...status()};let updated=0,failed=0;
  const batch=db.prepare('SELECT key FROM calendar_sync_jobs WHERE version>synced_version AND lease_until<? ORDER BY rowid LIMIT ?').all(Date.now(),limit) as {key:string}[];
  for(const {key} of batch){const claim=db.transaction(()=>{const row=db.prepare('SELECT * FROM calendar_sync_jobs WHERE key=?').get(key) as Job;if(row.version<=row.synced_version||row.lease_until>Date.now())return null;const lease=randomUUID();db.prepare('UPDATE calendar_sync_jobs SET lease=?,lease_until=? WHERE key=?').run(lease,Date.now()+120000,key);return {...row,lease};}).immediate();if(!claim)continue;
   try{if(claim.payload_json)await gateway.upsert(claim.google_id,JSON.parse(claim.payload_json));else await gateway.remove(claim.google_id);
    if(!claim.payload_json)db.prepare('UPDATE calendar_sync_jobs SET google_id=? WHERE key=? AND lease=?').run(createHash('sha256').update(`${namespace}/${key}/deleted/${claim.version}`).digest('hex'),key,claim.lease);
    db.prepare("UPDATE calendar_sync_jobs SET synced_version=?,lease=NULL,lease_until=0,last_error=NULL,synced_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE key=? AND lease=?").run(claim.version,key,claim.lease);updated++;
   }catch(e){db.prepare('UPDATE calendar_sync_jobs SET lease=NULL,lease_until=0,last_error=? WHERE key=? AND lease=?').run(e instanceof TaskError?e.message:'Googleカレンダーへの反映を確認できません。再同期してください',key,claim.lease);failed++;}
  }return {updated,attempt_failed:failed,...status()};
 }
 return {refresh,dispatch,status};
}
