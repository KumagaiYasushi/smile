import {after} from 'next/server';
import {getDb,getSeminarById} from '@/lib/db';
import {createMeetingStore} from '@/lib/meetings';
import {calendarEvents} from '@/types/calendar-sync';
import {createCalendarSyncStore} from '@/lib/calendar-sync';
import {createCalendarGoogle} from '@/lib/calendar-google';
export async function syncCalendar(all=false){
 const db=getDb(),store=createCalendarSyncStore(db),meetings=createMeetingStore(db);
 if(all)db.exec('INSERT INTO calendar_dirty_events(seminar_id) SELECT id FROM seminars WHERE true ON CONFLICT(seminar_id) DO UPDATE SET version=version+1');
 const dirty=db.prepare('SELECT seminar_id,version FROM calendar_dirty_events ORDER BY seminar_id LIMIT 200').all() as {seminar_id:number;version:number}[];
 for(const row of dirty)db.transaction(()=>{const event=getSeminarById(row.seminar_id);store.refresh(row.seminar_id,event?calendarEvents(event,meetings.list(event.id),(process.env.APP_ORIGIN??'').replace(/\/$/,'')):[]);db.prepare('DELETE FROM calendar_dirty_events WHERE seminar_id=? AND version=?').run(row.seminar_id,row.version);}).immediate();
 return store.dispatch(createCalendarGoogle(db));
}
export function scheduleCalendarSync(){after(async()=>{try{for(let batch=0;batch<30;batch++){const result=await syncCalendar();if(!result.updated||result.attempt_failed||(!result.pending&&!result.dirty))break;}}catch{/* Changes stay in the durable dirty queue/outbox for manual or scheduled retry. */}});}
