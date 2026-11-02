import type Database from 'better-sqlite3';
import {createStaffAttendanceStore} from './staff-attendance.ts';
import {countLunchAttendance} from '../types/lunch-defaults.ts';
import type {LunchCounts} from '../types/lunch.ts';
import type {ExternalSelection} from '../types/external-lecturer.ts';
export function getLunchDefaults(db:Database.Database,seminarId:number):Record<string,LunchCounts> {
  const staff=createStaffAttendanceStore(db).list(seminarId);
  const row=db.prepare('SELECT * FROM seminars WHERE id=?').get(seminarId) as {external_lecturer?:string;lecturer_role?:string;lecturer_name?:string};
  const external:ExternalSelection=row.external_lecturer?JSON.parse(row.external_lecturer):{status:'UNDECIDED',id:null,name:'',facility:''};
  if(external.status==='UNDECIDED'&&row.lecturer_role==='EXTERNAL_LECTURER'&&row.lecturer_name){external.status='YES';external.name=row.lecturer_name;}
  const participants=(db.prepare('SELECT count(*) n FROM participants WHERE seminar_id=?').get(seminarId) as {n:number}).n;
  return Object.fromEntries([...new Set([...staff.dates,''])].map(date=>{
    const counts=countLunchAttendance(staff.people,date||null,participants);
    const person=staff.people.find(p=>p.role==='EXTERNAL_LECTURER'&&p.name===external.name);
    counts.EXTERNAL_LECTURER=external.status==='YES'&&external.name?(person?.responses[date]!==undefined?(person.responses[date]==='ATTENDING'?1:0):1):0;
    return [date,counts];
  }));
}
