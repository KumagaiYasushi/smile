export const STUDY_CALENDAR_ID='ll3g7e3vbkom98qssfokalpl58@group.calendar.google.com';
export const STUDY_CALENDAR_ICS_URL='https://calendar.google.com/calendar/ical/ll3g7e3vbkom98qssfokalpl58%40group.calendar.google.com/public/basic.ics';
export type CalendarView='MONTH'|'AGENDA';
export function studyCalendarUrl(view:CalendarView='MONTH') {
  const url=new URL('https://calendar.google.com/calendar/embed');
  url.search=new URLSearchParams({src:STUDY_CALENDAR_ID,ctz:'Asia/Tokyo',hl:'ja',mode:view,showTitle:'0',showCalendars:'0',showTz:'0',wkst:'1'}).toString();
  return url.toString();
}
