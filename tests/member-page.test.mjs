import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createMemberPageStore } from '../lib/member-page.ts';
import { createTaskStore } from '../lib/tasks.ts';
import { createTaskRoleLinkStore } from '../lib/task-role-links.ts';
import { createEventRoleStore } from '../lib/event-roles.ts';
import { createSocietyMemberStore } from '../lib/society-members.ts';
import { createStaffRosterStore } from '../lib/staff-roster.ts';
import { emptyRoleAssignments, emptyDayRoles, roleAssignmentSubmission } from '../types/event-roles.ts';

function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
  db.exec(`CREATE TABLE auth_users(id INTEGER PRIMARY KEY,email TEXT,active INTEGER);
    INSERT INTO auth_users VALUES(1,'operator@example.invalid',1),(2,'inactive@example.invalid',0);
    CREATE TABLE seminars(id INTEGER PRIMARY KEY,name TEXT,dates TEXT,event_type TEXT,speakers TEXT,lecturer_name TEXT,lecturer_role TEXT,external_lecturer TEXT,assistant_members TEXT);
    INSERT INTO seminars VALUES(1,'複数回セミナー','["2027-06-01","2027-06-08"]','SEMINAR','[]','',NULL,'{"status":"NO","id":null,"name":"","facility":""}','[]'),
      (2,'過去の講演会','["2026-01-01"]','LECTURE','[]','',NULL,'{"status":"NO","id":null,"name":"","facility":""}','[]'),
      (3,'日程未定','[]','OTHER','[]','',NULL,'{"status":"NO","id":null,"name":"","facility":""}','[]');`);
  const page = createMemberPageStore(db), roles = createEventRoleStore(db), tasks = createTaskStore(db), links = createTaskRoleLinkStore(db), roster = createStaffRosterStore(db);
  const people = createSocietyMemberStore(db).list(), a = people.find(p => p.role === 'SOCIETY_LECTURER'), b = people.find(p => p.role === 'SOCIETY_SUPPORT');
  const person = p => ({ member_id: p.id, member_version: p.version });
  roles.save(1, { version: 0, assignments: { ...emptyRoleAssignments(), VENUE: [person(a), person(b)] }, day_assignments: {
    '2027-06-01': { ...emptyDayRoles(), CHAIR: [person(a)] }, '2027-06-08': { ...emptyDayRoles(), CHAIR: [person(b)] },
  } }, 1);
  const create = (title, role, date = null, input = {}) => {
    const task = tasks.createTask(1, { title, ...input }, 1);
    if (role) links.save(1, task.id, { role, date, version: 0 }, 1);
    return task;
  };
  const read = (id = a.id) => page.read(id, 1, '2027-06-01');
  const status = (event, task, next = 'DONE') => ({ status: next, version: task.version, link_version: task.role_link.version, role_version: event.role_version });
  const attendance = (memberId, date, response, extra = {}) => {
    const data = roster.list(1), row = data.rows.find(p => p.member_id === memberId);
    return { member_version: row.member_version, version: row.version, date, response, schedule: data.dates, ...extra };
  };
  return { db, page, roles, tasks, links, roster, a, b, person, create, read, status, attendance };
}

test('member pages select directory names without managing logins, show only each role and explicitly linked tasks for the correct dates', () => {
  const f = fixture(); const { db, page, a, b, create, read } = f;
  try {
    assert.equal(page.read(null, 1).member, null); assert.equal(page.read(null, 1).members.length, 10);
    const shared = create('会場確認', 'VENUE'), allDays = create('座長確認', 'CHAIR'), first = create('初日の座長', 'CHAIR', '2027-06-01');
    const second = create('二日目の座長', 'CHAIR', '2027-06-08'); create('未連動の座長という名前', null);
    const eventA = read().events.find(p => p.id === 1), eventB = read(b.id).events.find(p => p.id === 1);
    assert.deepEqual(new Set(eventA.tasks.map(t => t.id)), new Set([shared.id, allDays.id, first.id]));
    assert.deepEqual(new Set(eventB.tasks.map(t => t.id)), new Set([shared.id, allDays.id, second.id]));
    assert.deepEqual(eventA.roles, [{ role: 'VENUE', date: null }, { role: 'CHAIR', date: '2027-06-01' }]);
    assert.ok(read().events.find(e => e.id === 2).past); assert.ok(!read().events.find(e => e.id === 3).past);
    assert.equal(db.prepare('SELECT count(*) n FROM auth_users').get().n, 2);
    assert.equal(read().member.id, a.id); assert.throws(() => read(999), { status: 404 });
    assert.throws(() => page.read(a.id, 2), { status: 403 });
  } finally { db.close(); }
});

test('role links reject invalid dates and fields, prevent lost updates including unlink/relink, and audit changes atomically', () => {
  const { db, links, create } = fixture();
  try {
    const task = create('連動設定', null);
    for (const value of [null, [], {}, { role: 'toString', date: null, version: 0 }, { role: 'CHAIR', date: '2027-07-01', version: 0 },
      { role: 'VENUE', date: '2027-06-01', version: 0 }, { role: null, date: '', version: 0 }, { role: 'CHAIR', date: null, version: 0, actor_id: 99 }]) {
      assert.throws(() => links.save(1, task.id, value, 1));
    }
    let link = links.save(1, task.id, { role: 'CHAIR', date: '2027-06-01', version: 0 }, 1);
    assert.throws(() => links.save(1, task.id, { role: null, date: null, version: 0 }, 1), { status: 409 });
    link = links.save(1, task.id, { role: null, date: null, version: link.version }, 1);
    assert.equal(link.version, 2); assert.equal(link.role, null);
    assert.throws(() => links.save(2, task.id, { role: 'CHAIR', date: null, version: 2 }, 1), { status: 404 });
    assert.throws(() => links.save(1, task.id, { role: 'CHAIR', date: null, version: 2 }, 2), { status: 403 });
    db.exec("CREATE TRIGGER fail_link_audit BEFORE INSERT ON task_role_link_history BEGIN SELECT RAISE(ABORT,'audit failed');END");
    assert.throws(() => links.save(1, task.id, { role: 'CHAIR', date: null, version: 2 }, 1), /audit failed/);
    assert.deepEqual(links.read(1, task.id), link);
    db.prepare('DELETE FROM seminars WHERE id=1').run(); assert.equal(db.prepare('SELECT count(*) n FROM task_role_links').get().n, 0);
  } finally { db.close(); }
});

test('progress changes are shared across role assignees, preserve task fields, check task/role/link versions, and cannot edit assignments', () => {
  const { db, page, roles, tasks, links, a, b, create, read, status } = fixture();
  try {
    const original = create('共同の会場確認', 'VENUE', null, { assignee_id: 1, collaborator_ids: [1], due_date: '2027-06-01', description: '保持する説明' });
    const before = read().events.find(e => e.id === 1), task = before.tasks[0];
    for (const extra of [{ title: '改名' }, { assignee_id: 2 }, { role: 'CHAIR' }, { status: undefined }]) {
      assert.throws(() => page.setTaskStatus(a.id, 1, original.id, { ...status(before, task), ...extra }, 1));
    }
    page.setTaskStatus(a.id, 1, original.id, status(before, task, 'IN_PROGRESS'), 1);
    assert.equal(read(b.id).events.find(e => e.id === 1).tasks[0].status, 'IN_PROGRESS');
    assert.deepEqual({ ...tasks.getTask(1, original.id), version: original.version, updated_at: original.updated_at, status: original.status }, original);
    assert.throws(() => page.setTaskStatus(a.id, 1, original.id, status(before, task), 1), { status: 409 });
    const latest = read().events.find(e => e.id === 1), current = latest.tasks[0];
    let roleData = roles.read(1); const changed = roleAssignmentSubmission(roleData, roleData.members); changed.assignments.VENUE = changed.assignments.VENUE.filter(p => p.member_id !== a.id); roles.save(1, changed, 1);
    assert.equal(read().events.find(e => e.id === 1).tasks.length, 0);
    assert.throws(() => page.setTaskStatus(a.id, 1, original.id, status(latest, current), 1), { status: 409 });
    assert.throws(() => page.setTaskStatus(a.id, 1, original.id, { ...status(latest, current), role_version: roles.read(1).version }, 1), { status: 403 });
    const bEvent = read(b.id).events.find(e => e.id === 1), bTask = bEvent.tasks[0];
    links.save(1, original.id, { role: 'CHAIR', date: '2027-06-01', version: bTask.role_link.version }, 1);
    assert.throws(() => page.setTaskStatus(b.id, 1, original.id, status(bEvent, bTask), 1), { status: 409 });
    assert.equal(tasks.getTask(1, original.id).status, 'IN_PROGRESS');
  } finally { db.close(); }
});

test('attendance writes preserve other dates and members, reject stale edits, require speaker confirmation and flag conflicting roles', () => {
  const { db, page, a, b, read, attendance, roles } = fixture();
  try {
    db.prepare('UPDATE seminars SET speakers=? WHERE id=1').run(JSON.stringify([{ role: a.role, id: a.id, name: a.name, theme: '講演', facility: '', date: '2027-06-01' }]));
    const input = attendance(a.id, '2027-06-01', 'ABSENT');
    assert.throws(() => page.setAttendance(a.id, 1, input, 1), { status: 409 });
    page.setAttendance(a.id, 1, { ...input, confirm_speaker: true }, 1);
    const event = read().events.find(e => e.id === 1);
    assert.ok(event.alerts.some(a => a.kind === 'ROLE_ABSENCE')); assert.ok(event.alerts.some(a => a.kind === 'SPEAKER_ATTENDANCE'));
    assert.equal(event.attendance.responses['2027-06-01'], 'ABSENT');
    assert.ok(!read(b.id).events.find(e => e.id === 1).attendance.responses['2027-06-01']);
    assert.throws(() => page.setAttendance(a.id, 1, { ...input, confirm_speaker: true }, 1), { status: 409 });
    page.setAttendance(a.id, 1, attendance(a.id, '2027-06-08', 'AM_ONLY'), 1);
    assert.equal(read().events.find(e => e.id === 1).attendance.responses['2027-06-01'], 'ABSENT');
    assert.equal(roles.read(1).day_assignments['2027-06-01'].CHAIR[0].member_id, a.id);
    assert.throws(() => page.setAttendance(a.id, 1, { ...attendance(a.id, '2027-06-08', 'ATTENDING'), member_id: b.id }, 1), { status: 400 });
    assert.throws(() => page.setAttendance(a.id, 1, { ...attendance(a.id, '2027-06-08', 'ATTENDING'), schedule: [] }, 1), { status: 409 });
    db.exec("CREATE TRIGGER fail_attendance_audit BEFORE INSERT ON event_staff_history BEGIN SELECT RAISE(ABORT,'audit failed');END");
    assert.throws(() => page.setAttendance(a.id, 1, attendance(a.id, '2027-06-08', 'ATTENDING'), 1), /audit failed/);
    assert.equal(read().events.find(e => e.id === 1).attendance.responses['2027-06-08'], 'AM_ONLY');
  } finally { db.close(); }
});

test('alerts distinguish overdue, within seven days, completed tasks, past attendance, undated events and inactive members', () => {
  const { db, create, read, page, a } = fixture();
  try {
    create('期限超過', 'VENUE', null, { due_date: '2027-05-31' }); create('今日', 'VENUE', null, { due_date: '2027-06-01' });
    create('7日後', 'VENUE', null, { due_date: '2027-06-08' }); create('8日後', 'VENUE', null, { due_date: '2027-06-09' });
    create('完了', 'VENUE', null, { due_date: '2027-05-01', status: 'DONE' });
    const events = read().events, alerts = events.find(e => e.id === 1).alerts;
    assert.equal(alerts.filter(a => a.kind === 'OVERDUE').length, 1); assert.equal(alerts.filter(a => a.kind === 'DUE_SOON').length, 2);
    assert.equal(events.find(e => e.id === 2).alerts.length, 0); assert.equal(events.find(e => e.id === 3).alerts[0].kind, 'UNANSWERED');
    assert.equal(page.read(a.id, 1, '2027-06-02').events.find(e => e.id === 1).alerts.filter(a => a.kind === 'UNANSWERED').length, 1);
    db.prepare('UPDATE society_members SET active=0 WHERE id=?').run(a.id);
    assert.throws(() => read(), { status: 404 }); assert.ok(!page.read(null, 1).members.some(p => p.id === a.id));
  } finally { db.close(); }
});
