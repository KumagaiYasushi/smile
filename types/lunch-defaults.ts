import type {LunchCounts} from './lunch.ts';
import {isStaffAttending} from './staff-attendance.ts';
import type {StaffRole,StaffResponse} from './staff-attendance.ts';
export function countLunchAttendance(people:{role:StaffRole;responses:Record<string,StaffResponse>}[],date:string|null,participantCount:number):LunchCounts {
  const key=date??'';
  const count=(roles:StaffRole[])=>people.filter(p=>roles.includes(p.role)&&isStaffAttending(p.responses[key])).length;
  return {LECTURER:count(['SOCIETY_LECTURER','LECTURER']),SUPPORT:count(['SOCIETY_SUPPORT','SUPPORT']),EXTERNAL_LECTURER:count(['EXTERNAL_LECTURER']),PARTICIPANT:participantCount,OTHER:0};
}
