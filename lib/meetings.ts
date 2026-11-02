import type Database from 'better-sqlite3';
import {createSocietyMemberStore} from './society-members.ts';
import {parseMeeting,normalizeMeetingResponse} from '../types/meeting.ts';
import type {Meeting,MeetingInput,MeetingAttendee} from '../types/meeting.ts';
import {TaskError,parseVersion,parseId} from '../types/task.ts';
export function createMeetingStore(db:Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS event_meetings(id INTEGER PRIMARY KEY AUTOINCREMENT,seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,input_json TEXT NOT NULL CHECK(json_valid(input_json)),version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS event_meeting_history(id INTEGER PRIMARY KEY AUTOINCREMENT,seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,meeting_id INTEGER NOT NULL,actor_id INTEGER NOT NULL,action TEXT NOT NULL,before_json TEXT,after_json TEXT,occurred_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);
  const directory=createSocietyMemberStore(db);
  const decode=(row:{id:number;seminar_id:number;input_json:string;version:number}):Meeting=>{const {input_json,...meta}=row;const data=JSON.parse(input_json) as MeetingInput;return {...meta,...data,attendees:data.attendees.map(p=>({...p,response:normalizeMeetingResponse(p.response)}))};};
  function event(id:number){if(!db.prepare('SELECT id FROM seminars WHERE id=?').get(id))throw new TaskError('イベントが見つかりません',404);}
  function list(seminarId:number):Meeting[]{event(seminarId);return (db.prepare('SELECT * FROM event_meetings WHERE seminar_id=? ORDER BY id').all(seminarId) as Parameters<typeof decode>[0][]).map(decode);}
  function snapshot(value:Meeting|null){return value?JSON.stringify({date:value.date,time:value.time,method:value.method,version:value.version,attendees:value.attendees.map(({member_id,response})=>({member_id,response}))}):null;}
  function input(value:unknown,current?:Meeting):MeetingInput {
    const data=parseMeeting(value),members=directory.list();
    const attendees:MeetingAttendee[]=data.attendees.map(p=>{
      const member=members.find(m=>m.id===p.member_id),previous=current?.attendees.find(m=>m.member_id===p.member_id);
      if(!member||(!member.active&&!previous))throw new TaskError('利用できる研究会名簿から選択してください');
      if(member.version!==p.member_version)throw new TaskError('打ち合わせの名簿が変更されています。最新情報を取得してください',409);
      return {...p,name:previous?.name??member.name,role:previous?.role??member.role};
    });
    return {...data,attendees};
  }
  function apply(seminarId:number,value:unknown,actorId:number) {
    return db.transaction(()=>{
      event(seminarId);
      if(!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId))throw new TaskError('有効な運営メンバーとしてログインしてください',403);
      if(!Array.isArray(value)||value.length>100)throw new TaskError('打ち合わせの件数または変更形式が不正です');
      const touched=new Set<number>();
      for(const change of value){
        if(!change||typeof change!=='object'||Array.isArray(change))throw new TaskError('打ち合わせの変更形式が不正です');
        const body=change as Record<string,unknown>;
        if(Object.keys(body).some(key=>!['action','id','version','data'].includes(key)))throw new TaskError('打ち合わせに変更できない項目が含まれています');
        let before:Meeting|null=null,after:Meeting|null=null,id:number;
        if(body.action==='create'){
          if('id'in body||'version'in body)throw new TaskError('新しい打ち合わせにIDは指定できません');
          if(list(seminarId).length>=100)throw new TaskError('打ち合わせは100件以内で登録してください');
          const data=input(body.data);id=Number(db.prepare('INSERT INTO event_meetings(seminar_id,input_json) VALUES(?,?)').run(seminarId,JSON.stringify(data)).lastInsertRowid);
          after={...data,id,seminar_id:seminarId,version:1};
        }else if(body.action==='update'||body.action==='delete'){
          if(typeof body.id!=='number')throw new TaskError('打ち合わせのIDが不正です');
          id=parseId(String(body.id));if(touched.has(id))throw new TaskError('打ち合わせの変更対象が重複しています');touched.add(id);
          before=list(seminarId).find(p=>p.id===id)??null;if(!before)throw new TaskError('打ち合わせが見つかりません',404);
          if(parseVersion(body.version)!==before.version)throw new TaskError('別の操作で打ち合わせが更新されています。最新情報を取得してください',409);
          if(body.action==='delete'){if('data'in body)throw new TaskError('打ち合わせの削除形式が不正です');db.prepare('DELETE FROM event_meetings WHERE id=? AND seminar_id=?').run(id,seminarId);}
          else {const data=input(body.data,before);db.prepare('UPDATE event_meetings SET input_json=?,version=version+1 WHERE id=?').run(JSON.stringify(data),id);after={...data,id,seminar_id:seminarId,version:before.version+1};}
        }else throw new TaskError('打ち合わせの変更形式が不正です');
        db.prepare('INSERT INTO event_meeting_history(seminar_id,meeting_id,actor_id,action,before_json,after_json) VALUES(?,?,?,?,?,?)').run(seminarId,id,actorId,body.action,snapshot(before),snapshot(after));
      }
      return {meetings:list(seminarId),members:directory.list()};
    }).immediate();
  }
  return {list,apply,data(seminarId:number){return {meetings:list(seminarId),members:directory.list()};}};
}
