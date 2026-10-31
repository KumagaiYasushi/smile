import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';

export type User = { id: number; email: string; name: string; role: 'ADMIN' | 'MEMBER'; active: number; password_hash: string; mfa_secret: string | null; last_step: number };
export type Identity = Pick<User, 'id' | 'name' | 'role'>;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function newTotpSecret() {
  // Each character is uniformly distributed over the base32 alphabet (160 bits).
  return Array.from(randomBytes(32), byte => alphabet[byte & 31]).join('');
}

export function totp(secret: string, time = Date.now()) {
  let bits = '';
  for (const char of secret) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid base32');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = Buffer.from(bits.match(/.{8}/g)!.map(byte => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000)));
  const digest = createHmac('sha1', bytes).update(counter).digest();
  const offset = digest[19] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

function passwordHash(password: string, salt = randomBytes(16).toString('hex')) {
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
const dummyHash = passwordHash('dummy-password-never-used');

export class AuthStore {
  private db: Database.Database;
  private key: Buffer;
  private now: () => number;

  constructor(db: Database.Database, key: Buffer, now = () => Date.now()) {
    this.db = db;
    this.key = key;
    this.now = now;
    if (key.length !== 32) throw new Error('Invalid encryption key');
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('ADMIN','MEMBER')), active INTEGER NOT NULL DEFAULT 1,
        password_hash TEXT NOT NULL, mfa_secret TEXT, last_step INTEGER NOT NULL DEFAULT -1
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS auth_challenges (
        token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
        secret TEXT NOT NULL, expires_at INTEGER NOT NULL, failures INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS auth_attempts (
        subject_hash TEXT PRIMARY KEY, failures INTEGER NOT NULL, until_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, occurred_at INTEGER NOT NULL
      );
    `);
  }

  private seal(secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }

  private unseal(value: string) {
    const bytes = Buffer.from(value, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
  }

  audit(actor: number | null, action: string) {
    this.db.prepare('INSERT INTO audit_logs(actor_id,action,occurred_at) VALUES (?,?,?)').run(actor, action, this.now());
  }

  createUser(email: string, name: string, password: string, role: User['role'] = 'ADMIN') {
    // Synthetic accounts only until the production identity provider is selected.
    if (!/^[^@\s]+@[^@\s]+\.invalid$/.test(email) || !name.trim() || password.length < 12 || password.length > 256) {
      throw new Error('Use a fictional .invalid email, a name, and a 12–256 character password.');
    }
    if (role === 'ADMIN' && (this.db.prepare("SELECT COUNT(*) as n FROM users WHERE role='ADMIN'").get() as { n: number }).n >= 2) {
      throw new Error('Only two development administrators are allowed.');
    }
    const result = this.db.prepare('INSERT INTO users(email,name,role,password_hash) VALUES (?,?,?,?)')
      .run(email.toLowerCase(), name, role, passwordHash(password));
    this.audit(Number(result.lastInsertRowid), 'development_user_created');
  }

  login(email: string, password: string) {
    const normalized = email.toLowerCase().trim();
    const subject = hash(normalized);
    const attempt = this.db.prepare('SELECT failures,until_at FROM auth_attempts WHERE subject_hash=?').get(subject) as { failures: number; until_at: number } | undefined;
    if (attempt && attempt.until_at > this.now() && attempt.failures >= 5) return null;
    const user = this.db.prepare('SELECT * FROM users WHERE email=?').get(normalized) as User | undefined;
    const expected = user?.password_hash ?? dummyHash;
    const actual = passwordHash(password, expected.split(':')[0]);
    if (!timingSafeEqual(Buffer.from(actual), Buffer.from(expected)) || !user?.active || user.role !== 'ADMIN') {
      this.db.prepare(`INSERT INTO auth_attempts VALUES (?,1,?) ON CONFLICT(subject_hash) DO UPDATE SET
        failures=CASE WHEN until_at<=? THEN 1 ELSE failures+1 END, until_at=excluded.until_at`)
        .run(subject, this.now() + 900000, this.now());
      this.audit(null, 'login_rejected');
      return null;
    }
    this.db.prepare('DELETE FROM auth_attempts WHERE subject_hash=?').run(subject);
    const token = randomBytes(32).toString('hex');
    const secret = user.mfa_secret ? this.unseal(user.mfa_secret) : newTotpSecret();
    this.db.prepare('DELETE FROM auth_challenges WHERE user_id=? OR expires_at<=?').run(user.id, this.now());
    this.db.prepare('INSERT INTO auth_challenges(token_hash,user_id,secret,expires_at) VALUES (?,?,?,?)')
      .run(hash(token), user.id, this.seal(secret), this.now() + 300000);
    this.audit(user.id, 'password_verified');
    return { token, setupSecret: user.mfa_secret ? null : secret };
  }

  verifyMfa(token: string, code: string) {
    return this.db.transaction(() => {
      const challenge = this.db.prepare('SELECT * FROM auth_challenges WHERE token_hash=?').get(hash(token)) as
        { user_id: number; secret: string; expires_at: number; failures: number } | undefined;
      if (!challenge || challenge.expires_at <= this.now() || challenge.failures >= 5) return null;
      const user = this.db.prepare('SELECT * FROM users WHERE id=?').get(challenge.user_id) as User;
      if (!user.active || user.role !== 'ADMIN') return null;
      const subject = hash(`mfa:${user.id}`);
      const attempt = this.db.prepare('SELECT failures,until_at FROM auth_attempts WHERE subject_hash=?').get(subject) as { failures: number; until_at: number } | undefined;
      if (attempt && attempt.until_at > this.now() && attempt.failures >= 5) return null;
      const secret = this.unseal(challenge.secret);
      const step = [-1, 0, 1].map(offset => Math.floor(this.now() / 30000) + offset)
        .find(step => /^\d{6}$/.test(code) && step > user.last_step && totp(secret, step * 30000) === code);
      if (step === undefined) {
        this.db.prepare('UPDATE auth_challenges SET failures=failures+1 WHERE token_hash=?').run(hash(token));
        this.db.prepare(`INSERT INTO auth_attempts VALUES (?,1,?) ON CONFLICT(subject_hash) DO UPDATE SET
          failures=CASE WHEN until_at<=? THEN 1 ELSE failures+1 END, until_at=excluded.until_at`)
          .run(subject, this.now() + 900000, this.now());
        this.audit(user.id, 'mfa_rejected');
        return null;
      }
      this.db.prepare('UPDATE users SET mfa_secret=?,last_step=? WHERE id=?').run(this.seal(secret), step, user.id);
      this.db.prepare('DELETE FROM auth_attempts WHERE subject_hash=?').run(subject);
      this.db.prepare('DELETE FROM auth_challenges WHERE user_id=?').run(user.id);
      const sessionToken = randomBytes(32).toString('hex');
      this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(this.now());
      this.db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(hash(sessionToken), user.id, this.now() + 28800000);
      this.audit(user.id, 'login_completed');
      return sessionToken;
    })();
  }

  session(token: string): Identity | null {
    return this.db.prepare(`SELECT u.id,u.name,u.role FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>? AND u.active=1 AND u.role='ADMIN' AND u.mfa_secret IS NOT NULL`)
      .get(hash(token), this.now()) as Identity | undefined ?? null;
  }

  logout(token: string) {
    const identity = this.session(token);
    this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(token));
    if (identity) this.audit(identity.id, 'logout');
  }
}
