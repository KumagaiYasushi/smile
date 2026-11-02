import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { createAuthStore, hashPassword, totpCode } from '../lib/auth.ts';

const password = 'Synthetic-test-password-37';
const key = randomBytes(32).toString('hex');

function fixture() {
  const db = new Database(':memory:');
  return { db, auth: createAuthStore(db, key) };
}

test('password hashing is salted, rejects short passwords, and leaves no plaintext in DB', async () => {
  const { db, auth } = fixture();
  try {
    assert.notEqual(await hashPassword(password), await hashPassword(password));
    await assert.rejects(hashPassword('short'));
    await auth.createUser('Member@Example.invalid', password, 'member');
    assert.equal(db.prepare('SELECT email FROM auth_users').get().email, 'member@example.invalid');
    assert.ok(!db.prepare('SELECT password_hash FROM auth_users').get().password_hash.includes(password));
    await assert.rejects(auth.login('member@example.invalid', 'incorrect'), { status: 401 });
    await assert.rejects(auth.login('unknown@example.invalid', password), { status: 401 });
  } finally { db.close(); }
});

test('member sessions require real tokens and honor expiration, logout, deactivation and role changes', async () => {
  const { db, auth } = fixture();
  try {
    const user = await auth.createUser('member@example.invalid', password, 'member');
    const session = await auth.login(user.email, password);
    assert.equal(session.stage, 'full');
    assert.deepEqual(auth.getUser(session.token), user);
    assert.equal(auth.getUser('forged'), null);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM auth_sessions').all()).includes(session.token));
    db.prepare('UPDATE auth_users SET active=0').run();
    assert.equal(auth.getUser(session.token), null);
    db.prepare("UPDATE auth_users SET active=1,role='admin'").run();
    assert.equal(auth.getUser(session.token), null); // A previous member session cannot become an admin session.
    db.prepare("UPDATE auth_users SET role='member'").run();
    db.prepare('UPDATE auth_sessions SET expires_at=0').run();
    assert.equal(auth.getUser(session.token), null);
    const next = await auth.login(user.email, password);
    auth.logout(next.token);
    assert.equal(auth.getUser(next.token), null);
  } finally { db.close(); }
});

test('TOTP matches RFC 6238 SHA-1 vectors (six digits)', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totpCode(secret, 59), '287082');
  assert.equal(totpCode(secret, 1111111109), '081804');
  assert.equal(totpCode(secret, 2000000000), '279037');
});

test('administrators must complete MFA enrollment; secrets are encrypted and codes cannot be replayed', async () => {
  const { db, auth } = fixture();
  try {
    const admin = await auth.createUser('admin@example.invalid', password, 'admin');
    const challenge = await auth.login(admin.email, password);
    assert.equal(challenge.stage, 'setup');
    assert.equal(auth.getUser(challenge.token), null);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM auth_sessions').all()).includes(challenge.secret));
    assert.throws(() => auth.verifyMfa(challenge.token, 'invalid'), { status: 401 });
    const token = auth.verifyMfa(challenge.token, totpCode(challenge.secret));
    assert.equal(auth.getUser(token).role, 'admin');
    assert.ok(!db.prepare('SELECT mfa_secret FROM auth_users').get().mfa_secret.includes(challenge.secret));
    assert.throws(() => auth.verifyMfa(challenge.token, totpCode(challenge.secret)), { status: 401 });
    const next = await auth.login(admin.email, password);
    assert.equal(next.stage, 'mfa');
    assert.equal(next.secret, null);
    assert.throws(() => auth.verifyMfa(next.token, totpCode(challenge.secret)), { status: 401 });
    // Use the next accepted counter to test a subsequent login without sleeping.
    const step = db.prepare('SELECT last_totp_step FROM auth_users').get().last_totp_step;
    assert.ok(auth.getUser(auth.verifyMfa(next.token, totpCode(challenge.secret, (step + 1) * 30))));
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM auth_audit').all()).includes(challenge.secret));
  } finally { db.close(); }
});

test('MFA fails closed without its encryption key and admin count is capped at two', async () => {
  const { db, auth } = fixture();
  try {
    await assert.rejects(createAuthStore(db).createUser('admin@example.invalid', password, 'admin'), { status: 503 });
    const first = await auth.createUser('first@example.invalid', password, 'admin');
    await auth.createUser('second@example.invalid', password, 'admin');
    await assert.rejects(auth.createUser('third@example.invalid', password, 'admin'), { status: 409 });
    await assert.rejects(createAuthStore(db).login(first.email, password), { status: 503 });
  } finally { db.close(); }
});

test('failed password and OTP attempts are throttled and challenges expire', async () => {
  const { db, auth } = fixture();
  try {
    const admin = await auth.createUser('admin@example.invalid', password, 'admin');
    const challenge = await auth.login(admin.email, password);
    for (let i = 0; i < 5; i++) assert.throws(() => auth.verifyMfa(challenge.token, 'invalid'), { status: 401 });
    assert.throws(() => auth.verifyMfa(challenge.token, totpCode(challenge.secret)), { status: 429 });
    const next = await auth.login(admin.email, password);
    db.prepare('UPDATE auth_sessions SET expires_at=0').run();
    assert.throws(() => auth.verifyMfa(next.token, totpCode(next.secret)), { status: 401 });
    for (let i = 0; i < 6; i++) await assert.rejects(auth.login(admin.email, 'wrong'), { status: 401 });
    await assert.rejects(auth.login(admin.email, password), { status: 429 });
  } finally { db.close(); }
});
