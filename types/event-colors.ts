import type {EventType} from './seminar.ts';
export const EVENT_COLORS:Record<EventType,{card:string;header:string;badge:string;google:string}>={
 BASIC_COURSE:{card:'border-emerald-700 bg-emerald-100',header:'bg-emerald-900',badge:'border-emerald-400 bg-emerald-100 text-emerald-950',google:'10'},
 LECTURE:{card:'border-sky-700 bg-sky-100',header:'bg-sky-900',badge:'border-sky-400 bg-sky-100 text-sky-950',google:'9'},
 SEMINAR:{card:'border-violet-700 bg-violet-100',header:'bg-violet-900',badge:'border-violet-400 bg-violet-100 text-violet-950',google:'3'},
 OTHER:{card:'border-slate-600 bg-slate-100',header:'bg-slate-800',badge:'border-slate-400 bg-slate-100 text-slate-950',google:'8'},
};
