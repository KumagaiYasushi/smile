import type Database from 'better-sqlite3';
// No event FK: deletion must leave a durable request to remove the remote event.
export function installCalendarQueue(db:Database.Database,table:'seminars'|'event_meetings'){
  db.exec('CREATE TABLE IF NOT EXISTS calendar_dirty_events(seminar_id INTEGER PRIMARY KEY,version INTEGER NOT NULL DEFAULT 1)');
  for(const action of ['INSERT','UPDATE','DELETE']){
    const value=`${action==='DELETE'?'OLD':'NEW'}.${table==='seminars'?'id':'seminar_id'}`;
    db.exec(`CREATE TRIGGER IF NOT EXISTS calendar_dirty_${table}_${action.toLowerCase()} AFTER ${action} ON ${table} BEGIN INSERT INTO calendar_dirty_events(seminar_id) VALUES(${value}) ON CONFLICT(seminar_id) DO UPDATE SET version=version+1;END`);
  }
}
