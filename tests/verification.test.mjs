import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const script = fileURLToPath(new URL('../scripts/verification.mjs', import.meta.url));

test('verification setup uses a separate DB/key, seeds all features once, and preserves passwords and manual edits on repeat', () => {
  const directory = mkdtempSync(join(tmpdir(), 'smile-verification-'));
  const normal = join(directory, 'normal'), verification = join(directory, 'verification');
  mkdirSync(normal); const original = join(normal, 'seminars.db'); writeFileSync(original, 'normal-data-marker');
  const env = { ...process.env, SMILE_DATA_DIR: normal, SMILE_VERIFICATION_DATA_DIR: verification, AUTH_MFA_KEY: randomBytes(32).toString('hex') };
  const password = randomBytes(24).toString('base64url');
  let db;
  try {
    const output = execFileSync(process.execPath, [script, 'setup', 'verifier@example.invalid'], { env, input: JSON.stringify({ password }), encoding: 'utf8', stdio: 'pipe' });
    assert.ok(!output.includes(password));
    assert.equal(readFileSync(original, 'utf8'), 'normal-data-marker');
    const keyPath = join(verification, 'runtime.json');
    assert.equal(statSync(keyPath).mode & 0o777, 0o600);
    const keyHash = createHash('sha256').update(readFileSync(keyPath)).digest('hex');
    db = new Database(join(verification, 'seminars.db'));
    assert.equal(db.prepare('SELECT role FROM auth_users').get().role, 'member');
    const hash = db.prepare('SELECT password_hash FROM auth_users').get().password_hash;
    assert.ok(!hash.includes(password));
    assert.equal(db.prepare('SELECT count(*) n FROM seminars').get().n, 3);
    assert.equal(db.prepare('SELECT count(*) n FROM venues').get().n, 1);
    assert.equal(db.prepare('SELECT count(*) n FROM event_staff').get().n, 9);
    assert.equal(db.prepare('SELECT count(*) n FROM participants').get().n, 3);
    assert.equal(db.prepare('SELECT count(*) n FROM task_templates').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) n FROM event_tasks').get().n, 3);
    assert.equal(db.prepare("SELECT count(*) n FROM event_lunch_plans WHERE json_extract(input_json,'$.target')='EXTERNAL_LECTURER'").get().n, 3);
    db.prepare('UPDATE seminars SET notes=? WHERE id=1').run('手動編集を保持');
    execFileSync(process.execPath, [script, 'setup', 'verifier@example.invalid'], { env, input: '', stdio: 'pipe' });
    assert.equal(db.prepare('SELECT notes FROM seminars WHERE id=1').get().notes, '手動編集を保持');
    assert.equal(db.prepare('SELECT count(*) n FROM seminars').get().n, 3);
    assert.equal(db.prepare('SELECT password_hash FROM auth_users').get().password_hash, hash);
    assert.equal(createHash('sha256').update(readFileSync(keyPath)).digest('hex'), keyHash);
  } finally { db?.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('verification setup refuses to adopt an existing unmarked database or start without setup', () => {
  const directory = mkdtempSync(join(tmpdir(), 'smile-verification-guard-'));
  try {
    const database = join(directory, 'seminars.db'); writeFileSync(database, 'existing-data-marker');
    const env = { ...process.env, SMILE_VERIFICATION_DATA_DIR: directory };
    const result = spawnSync(process.execPath, [script, 'setup', 'verifier@example.invalid'], { env, input: '{}', encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.equal(readFileSync(database, 'utf8'), 'existing-data-marker');
    const start = spawnSync(process.execPath, [script, 'start'], { env: { ...process.env, SMILE_VERIFICATION_DATA_DIR: join(directory, 'new') }, encoding: 'utf8' });
    assert.equal(start.status, 1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('verification CLI can explicitly create an admin or promote its configured account without resetting data, credentials or MFA',async()=>{
 const {createAuthStore,totpCode}=await import('../lib/auth.ts');
 const directory=mkdtempSync(join(tmpdir(),'smile-verification-admin-')),env={...process.env,SMILE_VERIFICATION_DATA_DIR:directory},pw=randomBytes(24).toString('base64url');let db;
 const run=(role,email='owner@example.invalid')=>execFileSync(process.execPath,[script,'setup',email,`--role=${role}`],{env,input:JSON.stringify({password:pw}),encoding:'utf8',stdio:'pipe'});
 try{run('member');db=new Database(join(directory,'seminars.db'));const key=JSON.parse(readFileSync(join(directory,'runtime.json'),'utf8')).mfa_key,auth=createAuthStore(db,key),old=await auth.login('owner@example.invalid',pw),before=db.prepare('SELECT password_hash FROM auth_users').get().password_hash;db.exec("UPDATE seminars SET notes='保持する入力' WHERE id=1");
 run('admin');assert.equal(auth.getUser(old.token),null);assert.equal(db.prepare('SELECT role FROM auth_users').get().role,'admin');assert.equal(db.prepare('SELECT password_hash FROM auth_users').get().password_hash,before);assert.equal(db.prepare('SELECT notes FROM seminars WHERE id=1').get().notes,'保持する入力');const challenge=await auth.login('owner@example.invalid',pw);assert.equal(challenge.stage,'setup');const token=auth.verifyMfa(challenge.token,totpCode(challenge.secret)),mfa=db.prepare('SELECT mfa_secret FROM auth_users').get().mfa_secret;run('admin');assert.equal(auth.getUser(token).role,'admin');assert.equal(db.prepare('SELECT mfa_secret FROM auth_users').get().mfa_secret,mfa);assert.equal(JSON.parse(readFileSync(join(directory,'runtime.json'),'utf8')).mfa_key,key);run('member');assert.equal(auth.getUser(token).role,'admin');run('admin','new-admin@example.invalid');assert.equal((await auth.login('new-admin@example.invalid',pw)).stage,'setup');
 }finally{db?.close();rmSync(directory,{recursive:true,force:true});}
});
