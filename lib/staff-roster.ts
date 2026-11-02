import type Database from 'better-sqlite3';
import { createSocietyMemberStore } from './society-members.ts';
import { createStaffAttendanceStore } from './staff-attendance.ts';
import { attendanceDateKeys } from '../types/staff-attendance.ts';
import { ROSTER_RESPONSE_LABELS } from '../types/staff-roster.ts';
import type { StaffRoster, RosterResponse } from '../types/staff-roster.ts';
import { TaskError } from '../types/task.ts';

export function createStaffRosterStore(db: Database.Database) {
  const staff = createStaffAttendanceStore(db);
  const directory = createSocietyMemberStore(db);
  function list(seminarId: number): StaffRoster {
    return db.transaction(() => {
      const attendance = staff.list(seminarId);
      const links = db.prepare('SELECT member_id,person_id FROM event_staff_directory_links WHERE seminar_id=?').all(seminarId) as {member_id:number;person_id:number}[];
      const linkedIds = new Set(links.map(link => link.person_id));
      const rows = directory.list().map(member => {
        const linked = links.find(link => link.member_id === member.id);
        const person = linked ? attendance.people.find(person => person.id === linked.person_id)
          : attendance.people.find(person => person.name === member.name && person.role === member.role && !linkedIds.has(person.id));
        return { member_id: member.id, member_version: member.version, directory_name: member.name, active: member.active,
          name: person?.name ?? member.name, role: person?.role ?? member.role, person_id: person?.id ?? null,
          version: person?.version ?? 0, responses: person?.responses ?? {} };
      }).filter(row => row.active || row.person_id !== null);
      return { dates: attendance.dates, rows };
    })();
  }
  return {
    list,
    setResponse(seminarId: number, value: unknown, actorId: number) {
      return db.transaction(() => {
        if (!db.prepare('SELECT id FROM auth_users WHERE id=? AND active=1').get(actorId)) throw new TaskError('有効な運営メンバーとしてログインしてください',403);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TaskError('出欠の入力形式が不正です');
        const body = value as Record<string,unknown>;
        if (Object.keys(body).some(key => !['member_id','member_version','version','date','response','schedule'].includes(key))) throw new TaskError('変更できない項目が含まれています');
        if (typeof body.member_id !== 'number' || !Number.isSafeInteger(body.member_id) || body.member_id < 1) throw new TaskError('名簿のIDが不正です');
        const roster = list(seminarId), row = roster.rows.find(row => row.member_id === body.member_id);
        if (!row) throw new TaskError('選択できる名簿が見つかりません',404);
        if (body.member_version !== row.member_version || body.version !== row.version) throw new TaskError('名簿または出欠が変更されています。最新情報を取得してください',409);
        if (!Array.isArray(body.schedule) || JSON.stringify(body.schedule) !== JSON.stringify(roster.dates)) throw new TaskError('開催日が変更されています。最新情報を取得してください',409);
        if (typeof body.date !== 'string' || !attendanceDateKeys(roster.dates).includes(body.date)) throw new TaskError('現在の開催日から選択してください');
        if (typeof body.response !== 'string' || !Object.hasOwn(ROSTER_RESPONSE_LABELS,body.response)) throw new TaskError('出席・午前のみ・午後のみ・欠席・未登録から選択してください');
        const responses = Object.fromEntries(attendanceDateKeys(roster.dates).map(date => [date,row.responses[date] ?? 'UNANSWERED']));
        responses[body.date] = body.response as RosterResponse;
        const input = { name:row.name,role:row.role,schedule:roster.dates,responses };
        const person = row.person_id === null ? staff.create(seminarId,input,actorId)
          : staff.update(seminarId,row.person_id,{...input,version:row.version},actorId);
        db.prepare('INSERT OR IGNORE INTO event_staff_directory_links(person_id,seminar_id,member_id) VALUES(?,?,?)').run(person.id,seminarId,row.member_id);
        return { person, roster:list(seminarId) };
      }).immediate();
    },
  };
}
