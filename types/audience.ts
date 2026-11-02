import {TaskError} from './task.ts';
export const AUDIENCE_LABELS={dental_hygienist:'歯科衛生士',dentist:'歯科医師',other:'その他'} as const;
export type AudienceRole=keyof typeof AUDIENCE_LABELS;
export const allAudienceRoles=():AudienceRole[]=>['dental_hygienist','dentist','other'];
export function parseAudienceRoles(value:unknown):AudienceRole[] {
  if(!Array.isArray(value)||!value.length||value.length>3||new Set(value).size!==value.length||value.some(role=>typeof role!=='string'||!Object.hasOwn(AUDIENCE_LABELS,role)))throw new TaskError('主な参加対象を1つ以上選択してください');
  return allAudienceRoles().filter(role=>value.includes(role));
}
export const audienceText=(roles:AudienceRole[])=>roles.map(role=>AUDIENCE_LABELS[role]).join('・');
export function audienceFromLegacy(text:string):AudienceRole[]|null {
  const tokens=text.split(/[、・,\s]+/).filter(Boolean);
  if(!tokens.length||tokens.some(token=>!Object.values(AUDIENCE_LABELS).includes(token as typeof AUDIENCE_LABELS[AudienceRole])))return null;
  return allAudienceRoles().filter(role=>tokens.includes(AUDIENCE_LABELS[role]));
}
