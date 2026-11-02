import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type Database from 'better-sqlite3';

const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, result) => {
    if (error) reject(error); else resolve(result);
  });
});
const SESSION_SECONDS = 8 * 60 * 60;
const CHALLENGE_SECONDS = 5 * 60;
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export type AuthUser = { id: number; email: string; role: 'member' | 'admin' };
type UserRow = AuthUser & { password_hash: string; active: number; mfa_secret: string | null; last_totp_step: number };
type SessionRow = { user_id: number; kind: string; setup_secret: string | null; mfa_verified: number };

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) { super(message); this.status = status; }
}

const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const nowSeconds = () => Math.floor(Date.now() / 1000);
const normalizeEmail = (value: string) => value.trim().toLowerCase();

export async function hashPassword(password: string) {
  if (password.length < 12 || password.length > 128) throw new AuthError('パスワードは12〜128文字で設定してください', 400);
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `${salt}:${key.toString('hex')}`;
}

async function verifyPassword(password: string, stored: string | undefined) {
  const [salt, hash] = (stored ?? `${'0'.repeat(32)}:${'0'.repeat(64)}`).split(':');
  const key = await derive(password, salt);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === key.length && timingSafeEqual(key, expected) && stored !== undefined;
}

function newTotpSecret() {
  const bytes = randomBytes(20);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{5}/g)!.map((chunk) => alphabet[parseInt(chunk, 2)]).join('');
}

export function totpCode(secret: string, at = nowSeconds()) {
  const bits = [...secret].map((char) => {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid TOTP secret');
    return index.toString(2).padStart(5, '0');
  }).join('');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30)));
  const hmac = createHmac('sha1', key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

export function createAuthStore(db: Database.Database, encryptionKey?: string) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK(role IN ('member','admin')), password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1, mfa_secret TEXT, last_totp_step INTEGER NOT NULL DEFAULT -1
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES auth_users(id),
      kind TEXT NOT NULL CHECK(kind IN ('password','full')), setup_secret TEXT,
      mfa_verified INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_attempts (
      scope TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER, target_user_id INTEGER,
      action TEXT NOT NULL, occurred_at INTEGER NOT NULL
    );
  `);

  const audit = (id: number | null, action: string, target: number | null = null) => db.prepare(
    'INSERT INTO auth_audit(actor_id,target_user_id,action,occurred_at) VALUES(?,?,?,?)'
  ).run(id, target, action, nowSeconds());

  function key() {
    if (!encryptionKey || !/^[a-f0-9]{64}$/i.test(encryptionKey)) {
      throw new AuthError('管理者MFAの暗号化キーが未設定です。管理者に連絡してください', 503);
    }
    return Buffer.from(encryptionKey, 'hex');
  }
  function encrypt(secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key(), iv);
    const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('hex')).join(':');
  }
  function decrypt(value: string) {
    const [iv, tag, ciphertext] = value.split(':').map((part) => Buffer.from(part, 'hex'));
    const cipher = createDecipheriv('aes-256-gcm', key(), iv);
    cipher.setAuthTag(tag);
    return Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8');
  }
  function throttle(scope: string, limit: number, seconds: number) {
    const now = nowSeconds();
    db.prepare('DELETE FROM auth_attempts WHERE reset_at <= ?').run(now);
    db.prepare(`INSERT INTO auth_attempts(scope,attempts,reset_at) VALUES(?,1,?)
      ON CONFLICT(scope) DO UPDATE SET attempts=attempts+1`).run(scope, now + seconds);
    const row = db.prepare('SELECT attempts FROM auth_attempts WHERE scope=?').get(scope) as { attempts: number };
    if (row.attempts > limit) throw new AuthError('試行回数が上限に達しました。しばらく待って再試行してください', 429);
  }
  function issue(userId: number, kind: 'password' | 'full', setupSecret: string | null = null, mfa = false) {
    const token = randomBytes(32).toString('base64url');
    db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(nowSeconds());
    db.prepare(`INSERT INTO auth_sessions(token_hash,user_id,kind,setup_secret,mfa_verified,expires_at)
      VALUES(?,?,?,?,?,?)`).run(digest(token), userId, kind, setupSecret, mfa ? 1 : 0,
      nowSeconds() + (kind === 'full' ? SESSION_SECONDS : CHALLENGE_SECONDS));
    return token;
  }
  function session(token: string | undefined, kind: 'password' | 'full') {
    if (!token || token.length > 100) return null;
    return db.prepare('SELECT * FROM auth_sessions WHERE token_hash=? AND kind=? AND expires_at>?')
      .get(digest(token), kind, nowSeconds()) as SessionRow | undefined;
  }
  const userById = (id: number) => db.prepare('SELECT * FROM auth_users WHERE id=? AND active=1').get(id) as UserRow | undefined;
  const publicUser = (user: UserRow): AuthUser => ({ id: user.id, email: user.email, role: user.role });

  return {
    async createUser(email: string, password: string, role: AuthUser['role'], actorId: number | null = null) {
      email = normalizeEmail(email);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !['member','admin'].includes(role)) {
        throw new AuthError('メールアドレスまたは権限が不正です', 400);
      }
      if (role === 'admin') key();
      const hash = await hashPassword(password);
      return db.transaction(() => {
        const admins = db.prepare("SELECT count(*) n FROM auth_users WHERE role='admin' AND active=1").get() as { n: number };
        if (role === 'admin' && admins.n >= 2) throw new AuthError('管理者は2名までです', 409);
        const result = db.prepare('INSERT INTO auth_users(email,role,password_hash) VALUES(?,?,?)').run(email, role, hash);
        const id = Number(result.lastInsertRowid);
        audit(actorId, 'user_created', id);
        return { id, email, role };
      }).immediate();
    },
    listUsers() {
      return db.prepare('SELECT id,email,role,active,(mfa_secret IS NOT NULL) AS mfa_enabled FROM auth_users ORDER BY id').all();
    },
    async login(email: string, password: string) {
      if (email.length > 254 || password.length > 128) throw new AuthError('認証情報を確認してください');
      email = normalizeEmail(email);
      throttle('login-global', 100, 60);
      throttle(`login:${digest(email)}`, 8, 15 * 60);
      const user = db.prepare('SELECT * FROM auth_users WHERE email=?').get(email) as UserRow | undefined;
      const valid = await verifyPassword(password, user?.password_hash);
      if (!valid || !user || !user.active) {
        audit(null, 'login_failed');
        throw new AuthError('メールアドレスまたはパスワードを確認してください');
      }
      if (user.role === 'admin' || user.mfa_secret) {
        key();
        const secret = user.mfa_secret ? null : newTotpSecret();
        const token = issue(user.id, 'password', secret ? encrypt(secret) : null);
        audit(user.id, 'password_verified');
        return { token, stage: secret ? 'setup' as const : 'mfa' as const, secret,
          uri: secret ? `otpauth://totp/${encodeURIComponent(`smile:${user.email}`)}?secret=${secret}&issuer=smile&algorithm=SHA1&digits=6&period=30` : null };
      }
      audit(user.id, 'login_succeeded');
      return { token: issue(user.id, 'full'), stage: 'full' as const, secret: null, uri: null };
    },
    verifyMfa(token: string | undefined, code: string) {
      if (!token) throw new AuthError('ログインからやり直してください');
      throttle(`mfa:${digest(token)}`, 5, CHALLENGE_SECONDS);
      return db.transaction(() => {
        const challenge = session(token, 'password');
        const user = challenge && userById(challenge.user_id);
        if (!challenge || !user) throw new AuthError('ログインからやり直してください');
        const encrypted = user.mfa_secret ?? challenge.setup_secret;
        if (!encrypted || !/^\d{6}$/.test(code)) throw new AuthError('確認コードが不正です');
        const secret = decrypt(encrypted);
        const now = nowSeconds();
        const step = [-1, 0, 1].map((offset) => Math.floor(now / 30) + offset)
          .find((step) => step > user.last_totp_step && timingSafeEqual(Buffer.from(totpCode(secret, step * 30)), Buffer.from(code)));
        if (step === undefined) throw new AuthError('確認コードが不正、期限切れ、または使用済みです');
        db.prepare('UPDATE auth_users SET mfa_secret=?,last_totp_step=? WHERE id=?').run(encrypted, step, user.id);
        // Discard all password-only challenges after successful enrollment or MFA.
        db.prepare("DELETE FROM auth_sessions WHERE user_id=? AND kind='password'").run(user.id);
        audit(user.id, 'mfa_verified');
        return issue(user.id, 'full', null, true);
      }).immediate();
    },
    getUser(token: string | undefined): AuthUser | null {
      const current = session(token, 'full');
      const user = current && userById(current.user_id);
      if (!current || !user || ((user.role === 'admin' || user.mfa_secret) && (!current.mfa_verified || !user.mfa_secret))) return null;
      return publicUser(user);
    },
    logout(token: string | undefined) {
      if (!token) return;
      const current = db.prepare('SELECT user_id FROM auth_sessions WHERE token_hash=?').get(digest(token)) as { user_id: number } | undefined;
      db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(token));
      if (current) audit(current.user_id, 'logout');
    },
  };
}

export const AUTH_SESSION_SECONDS = SESSION_SECONDS;
export const AUTH_CHALLENGE_SECONDS = CHALLENGE_SECONDS;
