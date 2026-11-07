import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import {randomBytes} from 'node:crypto';
import {createAuthStore,totpCode} from '../lib/auth.ts';
import {bootstrapVerificationAdmin} from '../lib/verification-account.ts';
test('trusted bootstrap promotes only the selected member, revokes old sessions, retains password and requires MFA',async()=>{
 const db=new Database(':memory:');try{const auth=createAuthStore(db,randomBytes(32).toString('hex')),password=randomBytes(24).toString('base64url');const u=await auth.createUser('bootstrap@example.invalid',password,'member'),other=await auth.createUser('other@example.invalid',password,'member');const old=await auth.login(u.email,password),otherLogin=await auth.login(other.email,password);const hash=db.prepare('SELECT password_hash FROM auth_users WHERE id=?').get(u.id).password_hash;
 bootstrapVerificationAdmin(db,u.id);assert.equal(auth.getUser(old.token),null);assert.equal(auth.getUser(otherLogin.token).role,'member');assert.equal(db.prepare('SELECT password_hash FROM auth_users WHERE id=?').get(u.id).password_hash,hash);const login=await auth.login(u.email,password);assert.equal(login.stage,'setup');assert.equal(auth.getUser(login.token),null);const token=auth.verifyMfa(login.token,totpCode(login.secret));assert.equal(auth.getUser(token).role,'admin');bootstrapVerificationAdmin(db,u.id);assert.equal(auth.getUser(token).role,'admin');assert.equal(db.prepare("SELECT count(*) n FROM auth_audit WHERE action='verification_admin_bootstrap'").get().n,1);
 }finally{db.close();}
});
test('bootstrap enforces the admin cap and atomically rolls back role and sessions if auditing fails',async()=>{
 const db=new Database(':memory:');try{const auth=createAuthStore(db,randomBytes(32).toString('hex')),pw=randomBytes(24).toString('base64url'),u=await auth.createUser('candidate@example.invalid',pw,'member');const old=await auth.login(u.email,pw);db.exec("CREATE TRIGGER fail_bootstrap_audit BEFORE INSERT ON auth_audit WHEN NEW.action='verification_admin_bootstrap' BEGIN SELECT RAISE(ABORT,'audit failed');END");assert.throws(()=>bootstrapVerificationAdmin(db,u.id),/audit failed/);assert.equal(auth.getUser(old.token).role,'member');db.exec('DROP TRIGGER fail_bootstrap_audit');await auth.createUser('a@example.invalid',pw,'admin');await auth.createUser('b@example.invalid',pw,'admin');assert.throws(()=>bootstrapVerificationAdmin(db,u.id),/2名/);assert.equal(auth.getUser(old.token).role,'member');db.prepare('UPDATE auth_users SET active=0 WHERE id=?').run(u.id);assert.throws(()=>bootstrapVerificationAdmin(db,u.id),/有効/);
 }finally{db.close();}
});
