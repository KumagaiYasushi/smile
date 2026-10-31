import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { AuthStore, totp } from '../lib/auth-store.ts';
import { developmentDirectory } from '../lib/development.ts';

const password = 'fictional-password-for-tests';
function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  let time = 1800000000000;
  const store = new AuthStore(db, randomBytes(32), () => time);
  store.createUser('admin@example.invalid', '架空管理者', password);
  return { db, store, advance: (ms: number) => { time += ms; }, code: (secret: string) => totp(secret, time) };
}

test('TOTP matches RFC 6238 SHA1 vector (six-digit form)', () => {
  assert.equal(totp('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 59000), '287082');
});

test('password alone cannot create a session; enrollment is encrypted; MFA produces a session', () => {
  const { db, store, code } = fixture();
  const challenge = store.login('admin@example.invalid', password)!;
  assert(challenge.setupSecret);
  assert.equal(store.session(challenge.token), null);
  assert.equal((db.prepare('SELECT count(*) as n FROM sessions').get() as { n: number }).n, 0);
  assert.notEqual((db.prepare('SELECT secret FROM auth_challenges').get() as { secret: string }).secret, challenge.setupSecret);
  const token = store.verifyMfa(challenge.token, code(challenge.setupSecret))!;
  assert.equal(store.session(token)?.role, 'ADMIN');
  assert.equal(store.verifyMfa(challenge.token, code(challenge.setupSecret)), null);
  const dump = JSON.stringify(db.prepare('SELECT * FROM sessions').all()) + JSON.stringify(db.prepare('SELECT * FROM audit_logs').all());
  assert(!dump.includes(token));
  assert(!dump.includes(password));
  assert(!dump.includes(challenge.setupSecret));
  db.close();
});

test('unknown account and incorrect password are rejected; five failures lock account temporarily', () => {
  const { db, store, advance } = fixture();
  assert.equal(store.login('absent@example.invalid', password), null);
  for (let i = 0; i < 5; i++) assert.equal(store.login('admin@example.invalid', 'incorrect'), null);
  assert.equal(store.login('admin@example.invalid', password), null);
  advance(900001);
  assert(store.login('admin@example.invalid', password));
  db.close();
});

test('expired MFA challenge and five rejected MFA attempts cannot create a session', () => {
  const { db, store, advance } = fixture();
  let challenge = store.login('admin@example.invalid', password)!;
  advance(300001);
  assert.equal(store.verifyMfa(challenge.token, '000000'), null);
  challenge = store.login('admin@example.invalid', password)!;
  for (let i = 0; i < 5; i++) assert.equal(store.verifyMfa(challenge.token, 'invalid'), null);
  assert.equal(store.verifyMfa(challenge.token, totp(challenge.setupSecret!)), null);
  db.close();
});

test('session expires; deactivated accounts are denied; logout revokes session', () => {
  const { db, store, code, advance } = fixture();
  const challenge = store.login('admin@example.invalid', password)!;
  const token = store.verifyMfa(challenge.token, code(challenge.setupSecret!))!;
  assert(store.session(token));
  db.prepare('UPDATE users SET active=0').run();
  assert.equal(store.session(token), null);
  db.prepare('UPDATE users SET active=1').run();
  assert(store.session(token));
  advance(28800001);
  assert.equal(store.session(token), null);
  const next = store.login('admin@example.invalid', password)!;
  assert.equal(next.setupSecret, null);
  const token2 = store.verifyMfa(next.token, code(challenge.setupSecret!))!;
  assert(store.session(token2));
  store.logout(token2);
  assert.equal(store.session(token2), null);
  db.close();
});

test('restarting login cannot bypass the account-wide MFA attempt limit', () => {
  const { db, store, code, advance } = fixture();
  for (let i = 0; i < 5; i++) {
    const challenge = store.login('admin@example.invalid', password)!;
    assert.equal(store.verifyMfa(challenge.token, 'invalid'), null);
  }
  const blocked = store.login('admin@example.invalid', password)!;
  assert.equal(store.verifyMfa(blocked.token, code(blocked.setupSecret!)), null);
  advance(900001);
  const fresh = store.login('admin@example.invalid', password)!;
  assert(store.verifyMfa(fresh.token, code(fresh.setupSecret!)));
  db.close();
});

test('TOTP replay in another challenge is rejected; next time step succeeds', () => {
  const { db, store, code, advance } = fixture();
  const first = store.login('admin@example.invalid', password)!;
  assert(store.verifyMfa(first.token, code(first.setupSecret!)));
  const next = store.login('admin@example.invalid', password)!;
  assert.equal(store.verifyMfa(next.token, code(first.setupSecret!)), null);
  advance(30000);
  assert(store.verifyMfa(next.token, code(first.setupSecret!)));
  db.close();
});

test('local test access is admin only; real email and third admin provisioning are rejected', () => {
  const { db, store } = fixture();
  assert.throws(() => store.createUser('real@example.com', '実アカウント', password));
  store.createUser('member@example.invalid', '架空メンバー', password, 'MEMBER');
  assert.equal(store.login('member@example.invalid', password), null);
  store.createUser('second@example.invalid', '架空管理者B', password);
  assert.throws(() => store.createUser('third@example.invalid', '架空管理者C', password));
  db.close();
});

test('environment is explicitly nonproduction; development/test use different storage', () => {
  const previous = process.env.SMILE_ENV;
  try {
    delete process.env.SMILE_ENV;
    assert.throws(developmentDirectory);
    process.env.SMILE_ENV = 'production';
    assert.throws(developmentDirectory);
    process.env.SMILE_ENV = 'development';
    const dev = developmentDirectory();
    process.env.SMILE_ENV = 'test';
    assert.notEqual(developmentDirectory(), dev);
  } finally {
    if (previous === undefined) delete process.env.SMILE_ENV;
    else process.env.SMILE_ENV = previous;
  }
});
