import type {RoleAssignmentInput} from './event-roles.ts';
import type {MeetingChange} from './meeting.ts';
import type { RosterResponse } from './staff-roster.ts';
import type { LunchInput } from './lunch.ts';
export type AttendanceDraft = { member_id:number; member_version:number; version:number; responses:Record<string,RosterResponse> };
export type LunchChange = {action:'create';data:LunchInput} | {action:'update';id:number;version:number;data:LunchInput} | {action:'delete';id:number;version:number};
export type EventRegistration = { schedule:string[]; attendance:AttendanceDraft[]; lunch:LunchChange[]; meetings?:MeetingChange[];roles?:RoleAssignmentInput };
export type LunchDraft = {key:string;id?:number;version?:number;data:LunchInput;dirty:boolean};
