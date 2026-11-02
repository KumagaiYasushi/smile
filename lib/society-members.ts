import type Database from 'better-sqlite3';
import { TaskError, parseVersion } from '../types/task.ts';
import { parseSocietyMember } from '../types/society-member.ts';
export const INITIAL_SOCIETY_MEMBERS = { SOCIETY_LECTURER: ['若林健史','熊谷靖司','小林明子','児玉加代子','塚本佳子','塩浦有紀'], SOCIETY_SUPPORT: ['疋田莉惠','浮蓮真由美','鈴木亜紀','百田理恵子'] } as const;
import type { SocietyMember } from '../types/society-member.ts';
export function createSocietyMemberStore(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS society_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('SOCIETY_LECTURER','SOCIETY_SUPPORT')),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),version INTEGER NOT NULL DEFAULT 1,UNIQUE(role,name));
    CREATE TABLE IF NOT EXISTS society_member_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,person_id INTEGER NOT NULL REFERENCES society_members(id),actor_id INTEGER NOT NULL,
    action TEXT NOT NULL, before_json TEXT,after_json TEXT NOT NULL,occurred_at TEXT NOT NULL DEFAULT(strftime('%Y-%m-%dT%H:%M:%fZ','now')));
    CREATE TABLE IF NOT EXISTS society_directory_seed(id INTEGER PRIMARY KEY CHECK(id=1));`);
  db.transaction(()=>{
    if(db.prepare('SELECT id FROM society_directory_seed WHERE id=1').get())return;
    for(const [role,names] of Object.entries(INITIAL_SOCIETY_MEMBERS))for(const name of names)db.prepare('INSERT OR IGNORE INTO society_members(name,role) VALUES(?,?)').run(name,role);
    db.prepare('INSERT INTO society_directory_seed(id) VALUES(1)').run();
  }).immediate();
  function list(): SocietyMember[] {
    return (db.prepare('SELECT * FROM society_members ORDER BY role,name,id').all() as (Omit<SocietyMember,'active'> & {active:number})[]).map(row=>({...row,active:!!row.active}));
  }
  return { list,
    save(value: unknown, actorId: number, id?: number) {
      return db.transaction(()=>{
        if(!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId)) throw new TaskError('有効な運営メンバーとしてログインしてください',403);
        const input=parseSocietyMember(value), current=id ? list().find(person=>person.id===id) : undefined;
        if(id && !current) throw new TaskError('名簿が見つかりません',404);
        if(current && parseVersion((value as {version?:unknown}).version)!==current.version) throw new TaskError('別の操作で更新されています。最新情報を取得してください',409);
        if(db.prepare('SELECT id FROM society_members WHERE role=? AND name=? AND id!=?').get(input.role,input.name,id??0)) throw new TaskError('同じ区分・氏名が登録されています',409);
        if(current) db.prepare('UPDATE society_members SET name=?,role=?,active=?,version=version+1 WHERE id=?').run(input.name,input.role,+input.active,id);
        else id=Number(db.prepare('INSERT INTO society_members(name,role,active) VALUES(?,?,?)').run(input.name,input.role,+input.active).lastInsertRowid);
        const after=list().find(person=>person.id===id)!;
        const snapshot=(p:SocietyMember)=>JSON.stringify({role:p.role,active:p.active,version:p.version});
        db.prepare('INSERT INTO society_member_history(person_id,actor_id,action,before_json,after_json) VALUES(?,?,?,?,?)').run(id,actorId,current?'updated':'created',current?snapshot(current):null,snapshot(after));
        return after;
      }).immediate();
    }
  };
}
