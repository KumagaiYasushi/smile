import {createMeetingStore} from './meetings.ts';
import {MEETING_METHOD_LABELS} from '../types/meeting.ts';
import type Database from 'better-sqlite3';
import {createSocietyMemberStore} from './society-members.ts';
import {TaskError} from '../types/task.ts';
import {parsePollSettings,POLL_RESPONSE_LABELS} from '../types/meeting-poll.ts';
import type {MeetingPollData,PollCandidate,PollAnswer,PollResponse} from '../types/meeting-poll.ts';

export function createMeetingPollStore(db:Database.Database){
  const meetings=createMeetingStore(db);
  db.exec(`CREATE TABLE IF NOT EXISTS meeting_polls(seminar_id INTEGER PRIMARY KEY REFERENCES seminars(id) ON DELETE CASCADE,title TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS meeting_poll_candidates(id INTEGER PRIMARY KEY AUTOINCREMENT,seminar_id INTEGER NOT NULL REFERENCES meeting_polls(seminar_id) ON DELETE CASCADE,date TEXT NOT NULL,start TEXT NOT NULL,end TEXT,revision INTEGER NOT NULL DEFAULT 1);
    CREATE INDEX IF NOT EXISTS meeting_poll_candidate_event ON meeting_poll_candidates(seminar_id,date,start,id);
    CREATE TABLE IF NOT EXISTS meeting_poll_answers(candidate_id INTEGER NOT NULL REFERENCES meeting_poll_candidates(id) ON DELETE CASCADE,member_id INTEGER NOT NULL REFERENCES society_members(id),response TEXT CHECK(response IN ('YES','MAYBE','NO')),version INTEGER NOT NULL DEFAULT 1,actor_id INTEGER NOT NULL,updated_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')),PRIMARY KEY(candidate_id,member_id));
    CREATE TABLE IF NOT EXISTS meeting_poll_history(id INTEGER PRIMARY KEY AUTOINCREMENT,seminar_id INTEGER NOT NULL REFERENCES seminars(id) ON DELETE CASCADE,actor_id INTEGER NOT NULL,action TEXT NOT NULL,before_json TEXT,after_json TEXT,occurred_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));`);
  db.exec(`CREATE TABLE IF NOT EXISTS meeting_poll_decisions(seminar_id INTEGER PRIMARY KEY REFERENCES seminars(id) ON DELETE CASCADE,candidate_id INTEGER NOT NULL,revision INTEGER NOT NULL,meeting_id INTEGER REFERENCES event_meetings(id) ON DELETE SET NULL,meeting_version INTEGER NOT NULL)`);
  const directory=createSocietyMemberStore(db);
  function event(id:number){if(!db.prepare('SELECT id FROM seminars WHERE id=?').get(id))throw new TaskError('イベントが見つかりません',404);}
  function actor(id:number){if(!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(id))throw new TaskError('有効な運営メンバーとしてログインしてください',403);}
  function data(seminarId:number):MeetingPollData{
    return db.transaction(()=>{
      event(seminarId);
      const settings=db.prepare('SELECT title,version FROM meeting_polls WHERE seminar_id=?').get(seminarId) as {title:string;version:number}|undefined;
      const candidates=db.prepare('SELECT id,date,start,end,revision FROM meeting_poll_candidates WHERE seminar_id=? ORDER BY date,start,id').all(seminarId) as PollCandidate[];
      const answers=db.prepare('SELECT a.candidate_id,a.member_id,a.response,a.version FROM meeting_poll_answers a JOIN meeting_poll_candidates c ON c.id=a.candidate_id WHERE c.seminar_id=?').all(seminarId) as PollAnswer[];
      const decision=db.prepare('SELECT d.candidate_id,d.revision,d.meeting_id,(m.version=d.meeting_version) AS current FROM meeting_poll_decisions d LEFT JOIN event_meetings m ON m.id=d.meeting_id WHERE d.seminar_id=?').get(seminarId) as MeetingPollData['decision'];
      return {...(decision?{decision:{...decision,current:!!decision.current}}:{}),...(settings??{title:'打ち合わせの日程調整',version:0}),candidates,answers,members:directory.list().filter(m=>m.active||answers.some(a=>a.member_id===m.id))};
    })();
  }
  function history(seminarId:number,actorId:number,action:string,before:unknown,after:unknown){db.prepare('INSERT INTO meeting_poll_history(seminar_id,actor_id,action,before_json,after_json) VALUES(?,?,?,?,?)').run(seminarId,actorId,action,JSON.stringify(before),JSON.stringify(after));}
  function save(seminarId:number,value:unknown,actorId:number){
    return db.transaction(()=>{
      actor(actorId);const input=parsePollSettings(value),current=data(seminarId);
      if(input.version!==current.version)throw new TaskError('候補日時が別の操作で変更されています。最新の表を取得してください',409);
      for(const c of input.candidates)if(c.id!==undefined&&!current.candidates.some(p=>p.id===c.id))throw new TaskError('このイベントの候補日時が見つかりません',404);
      if(current.version===0)db.prepare('INSERT INTO meeting_polls(seminar_id,title) VALUES(?,?)').run(seminarId,input.title);
      else db.prepare('UPDATE meeting_polls SET title=?,version=version+1 WHERE seminar_id=?').run(input.title,seminarId);
      for(const old of current.candidates){
        const next=input.candidates.find(c=>c.id===old.id);
        if(!next)db.prepare('DELETE FROM meeting_poll_candidates WHERE id=?').run(old.id);
        else if(next.date!==old.date||next.start!==old.start||next.end!==old.end){
          db.prepare('UPDATE meeting_poll_candidates SET date=?,start=?,end=?,revision=revision+1 WHERE id=?').run(next.date,next.start,next.end,old.id);
          db.prepare('DELETE FROM meeting_poll_answers WHERE candidate_id=?').run(old.id);
        }
      }
      for(const c of input.candidates.filter(p=>p.id===undefined))db.prepare('INSERT INTO meeting_poll_candidates(seminar_id,date,start,end) VALUES(?,?,?,?)').run(seminarId,c.date,c.start,c.end);
      const after=data(seminarId);history(seminarId,actorId,'settings',{title:current.title,version:current.version,candidates:current.candidates},{title:after.title,version:after.version,candidates:after.candidates});return after;
    }).immediate();
  }
  function answer(seminarId:number,value:unknown,actorId:number){
    return db.transaction(()=>{
      actor(actorId);event(seminarId);
      if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('回答の形式が不正です');
      const b=value as Record<string,unknown>;
      if(Object.keys(b).some(k=>!['member_id','member_version','candidate_id','revision','version','response'].includes(k)))throw new TaskError('回答に変更できない項目が含まれています');
      for(const k of ['member_id','member_version','candidate_id','revision','version'])if(typeof b[k]!=='number'||!Number.isSafeInteger(b[k])||(b[k] as number)<(k==='version'?0:1))throw new TaskError('回答のIDまたは版が不正です');
      if(b.response!==null&&(typeof b.response!=='string'||!Object.hasOwn(POLL_RESPONSE_LABELS,b.response)))throw new TaskError('○・△・×から回答してください');
      const member=directory.list().find(m=>m.id===b.member_id&&m.active);
      if(!member)throw new TaskError('回答できるメンバーが見つかりません',404);
      if(member.version!==b.member_version)throw new TaskError('名簿が変更されています。最新の表を取得してください',409);
      const candidate=db.prepare('SELECT id,revision FROM meeting_poll_candidates WHERE id=? AND seminar_id=?').get(b.candidate_id,seminarId) as {id:number;revision:number}|undefined;
      if(!candidate)throw new TaskError('候補日時が見つかりません。最新の表を取得してください',404);
      if(candidate.revision!==b.revision)throw new TaskError('候補日時が変更されています。最新の表を取得してください',409);
      const before=db.prepare('SELECT candidate_id,member_id,response,version FROM meeting_poll_answers WHERE candidate_id=? AND member_id=?').get(b.candidate_id,b.member_id) as PollAnswer|undefined;
      if((before?.version??0)!==b.version)throw new TaskError('この回答が別の操作で変更されています。最新の表を取得してください',409);
      db.prepare(`INSERT INTO meeting_poll_answers(candidate_id,member_id,response,actor_id) VALUES(?,?,?,?) ON CONFLICT(candidate_id,member_id) DO UPDATE SET response=excluded.response,version=meeting_poll_answers.version+1,actor_id=excluded.actor_id,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`).run(b.candidate_id,b.member_id,b.response,actorId);
      history(seminarId,actorId,'answer',before??null,{candidate_id:b.candidate_id,member_id:b.member_id,response:b.response as PollResponse|null,version:(before?.version??0)+1});return data(seminarId);
    }).immediate();
  }
  function decide(seminarId:number,value:unknown,actorId:number){
    return db.transaction(()=>{
      actor(actorId);const current=data(seminarId);
      if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('日程決定の入力形式が不正です');
      const b=value as Record<string,unknown>;
      if(Object.keys(b).some(k=>!['candidate_id','revision','version','title','method'].includes(k)))throw new TaskError('日程決定に変更できない項目が含まれています');
      if(typeof b.candidate_id!=='number'||!Number.isSafeInteger(b.candidate_id)||b.candidate_id<1||typeof b.revision!=='number'||!Number.isSafeInteger(b.revision)||b.revision<1||typeof b.version!=='number'||!Number.isSafeInteger(b.version))throw new TaskError('候補日時のIDまたは版が不正です');
      const c=current.candidates.find(c=>c.id===b.candidate_id);if(!c)throw new TaskError('候補日時が見つかりません',404);
      if(current.version!==b.version||c.revision!==b.revision)throw new TaskError('候補日時が変更されています。最新の表を取得してください',409);
      if(typeof b.title!=='string'||!b.title.trim()||b.title.trim().length>200||typeof b.method!=='string'||!Object.hasOwn(MEETING_METHOD_LABELS,b.method))throw new TaskError('打ち合わせ名と開催方法を確認してください');
      const old=db.prepare('SELECT * FROM meeting_poll_decisions WHERE seminar_id=?').get(seminarId) as {candidate_id:number;revision:number;meeting_id:number|null;meeting_version:number}|undefined;
      const existing=old?.meeting_id?meetings.list(seminarId).find(m=>m.id===old.meeting_id):undefined;
      if(existing&&existing.version===old!.meeting_version&&old!.candidate_id===c.id&&old!.revision===c.revision)return {poll:current,meeting:existing,already:true};
      if(existing&&existing.version!==old!.meeting_version)throw new TaskError('確定した打ち合わせが編集されています。打ち合わせの登録欄で日時を変更してください',409);
      const input={title:b.title.trim(),date:c.date,time:c.start,end_time:c.end,method:b.method,attendees:directory.list().filter(m=>m.active).map(m=>({member_id:m.id,member_version:m.version,response:null}))};
      const result=meetings.apply(seminarId,[existing?{action:'update',id:existing.id,version:existing.version,data:input}:{action:'create',data:input}],actorId);
      const meeting=existing?result.meetings.find(m=>m.id===existing.id)!:result.meetings.at(-1)!;
      db.prepare(`INSERT INTO meeting_poll_decisions(seminar_id,candidate_id,revision,meeting_id,meeting_version) VALUES(?,?,?,?,?) ON CONFLICT(seminar_id) DO UPDATE SET candidate_id=excluded.candidate_id,revision=excluded.revision,meeting_id=excluded.meeting_id,meeting_version=excluded.meeting_version`).run(seminarId,c.id,c.revision,meeting.id,meeting.version);
      history(seminarId,actorId,'decided',old??null,{candidate_id:c.id,revision:c.revision,meeting_id:meeting.id});return {poll:data(seminarId),meeting,already:false};
    }).immediate();
  }
  return {data,save,answer,decide};
}
