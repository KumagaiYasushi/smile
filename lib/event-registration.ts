import {createMeetingStore} from './meetings.ts';
import type Database from 'better-sqlite3';
import { createStaffRosterStore } from './staff-roster.ts';
import { createLunchStore } from './lunch.ts';
import { TaskError,parseVersion } from '../types/task.ts';

export function createEventRegistrationStore(db:Database.Database) {
  const roster=createStaffRosterStore(db),lunch=createLunchStore(db),meetings=createMeetingStore(db);
  function object(value:unknown):Record<string,unknown> {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('出欠・昼食の入力形式が不正です');
    return value as Record<string,unknown>;
  }
  function id(value:unknown) {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)throw new TaskError('昼食のIDが不正です');return value;}
  function apply(seminarId:number,value:unknown,actorId:number) {
    if(value===undefined)return;
    const body=object(value);
    if(Object.keys(body).some(key=>!['schedule','attendance','lunch','meetings'].includes(key)))throw new TaskError('出欠・昼食に変更できない項目が含まれています');
    const current=roster.list(seminarId);
    if(!Array.isArray(body.schedule)||JSON.stringify(body.schedule)!==JSON.stringify(current.dates))throw new TaskError('開催日が変更されています。出欠・昼食を再確認してください',409);
    if(!Array.isArray(body.attendance)||body.attendance.length>1000||!Array.isArray(body.lunch)||body.lunch.length>100)throw new TaskError('出欠・昼食の件数または入力形式が不正です');
    const members=new Set<number>();
    for(const item of body.attendance) {
      const input=object(item);
      if(Object.keys(input).some(key=>!['member_id','member_version','version','responses'].includes(key)))throw new TaskError('出欠に変更できない項目が含まれています');
      if(typeof input.member_id!=='number'||members.has(input.member_id))throw new TaskError('出欠の対象が重複しているか不正です');
      members.add(input.member_id);
      const responses=object(input.responses);
      if(!Object.keys(responses).length)throw new TaskError('出欠を選択してください');
      let version=input.version;
      for(const [date,response]of Object.entries(responses)) {
        const result=roster.setResponse(seminarId,{member_id:input.member_id,member_version:input.member_version,version,date,response,schedule:body.schedule},actorId);
        version=result.person.version;
      }
    }
    const plans=new Set<number>();
    for(const item of body.lunch) {
      const input=object(item);
      if(Object.keys(input).some(key=>!['action','id','version','data'].includes(key)))throw new TaskError('昼食に変更できない項目が含まれています');
      if(input.action==='create') {
        if('id'in input||'version'in input)throw new TaskError('新しい昼食にIDは指定できません');
        lunch.create(seminarId,{...object(input.data),schedule:body.schedule},actorId);
      } else if(input.action==='update'||input.action==='delete') {
        const planId=id(input.id),version=parseVersion(input.version);
        if(plans.has(planId))throw new TaskError('昼食の変更対象が重複しています');
        plans.add(planId);
        if(input.action==='delete') {
          if('data'in input)throw new TaskError('昼食の削除形式が不正です');
          lunch.remove(seminarId,planId,{version},actorId);
        } else lunch.update(seminarId,planId,{...object(input.data),schedule:body.schedule,version},actorId);
      } else throw new TaskError('昼食の変更形式が不正です');
    }
    if(body.meetings!==undefined)meetings.apply(seminarId,body.meetings,actorId);
  }
  return {
    save<T extends {id:number}>(saveEvent:()=>T,registration:unknown,actorId:number):T {
      return db.transaction(()=>{
        if(!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId))throw new TaskError('有効な運営メンバーとしてログインしてください',403);
        const event=saveEvent();apply(event.id,registration,actorId);return event;
      }).immediate();
    }
  };
}
