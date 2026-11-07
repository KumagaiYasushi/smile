import { existsSync, mkdirSync, readFileSync, writeFileSync, lstatSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { readPassword } from './password-input.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = resolve(process.env.SMILE_VERIFICATION_DATA_DIR ?? join(project, 'data', 'verification'));
const [action, email] = process.argv.slice(2);
let db;
try {
  const role=(process.argv.slice(2).find(v=>v.startsWith('--role='))??'--role=member').slice(7);
  if(!['member','admin'].includes(role))throw new Error('検証用アカウントの権限は member または admin を指定してください');
  if (!['setup', 'start'].includes(action) || (action === 'setup' && !email)) throw new Error('使い方: npm run verification:setup -- <メールアドレス> / npm run verification:start');
  if (directory === join(project, 'data')) throw new Error('通常のデータディレクトリは検証用に使用できません');
  if (existsSync(directory) && lstatSync(directory).isSymbolicLink()) throw new Error('検証用ディレクトリにシンボリックリンクは使用できません');
  const marker = join(directory, 'verification.json'), keyFile = join(directory, 'runtime.json'), database = join(directory, 'seminars.db');
  if (existsSync(database) && (!existsSync(marker) || lstatSync(database).isSymbolicLink())) throw new Error('既存DBを検証用に転用できません。別の専用ディレクトリを指定してください');
  if (action === 'setup') {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!existsSync(marker)) writeFileSync(marker, JSON.stringify({ kind: 'smile-verification', version: 1 }), { flag: 'wx', mode: 0o600 });
  }
  if (!existsSync(marker) || JSON.parse(readFileSync(marker, 'utf8')).kind !== 'smile-verification') throw new Error('先に verification:setup を実行してください');
  if (!existsSync(keyFile) && action === 'setup') writeFileSync(keyFile, JSON.stringify({ mfa_key: randomBytes(32).toString('hex') }), { flag: 'wx', mode: 0o600 });
  if (!existsSync(keyFile) || lstatSync(keyFile).isSymbolicLink()) throw new Error('検証用の秘密設定が見つかりません');
  chmodSync(keyFile, 0o600);
  const key = JSON.parse(readFileSync(keyFile, 'utf8')).mfa_key;
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error('検証用の秘密設定が不正です');
  // Explicitly override inherited runtime settings; never load the normal .env.local.
  process.env.SMILE_DATA_DIR = directory;
  process.env.AUTH_MFA_KEY = key;
  process.env.SMILE_VERIFICATION_MODE = '1';
  if (action === 'setup') {
    const { getDb } = await import('../lib/db.ts');
    const { createAuthStore } = await import('../lib/auth.ts');
    const { seedVerification } = await import('../lib/verification.ts');
    db = getDb();
    const auth = createAuthStore(db, key);
    let user = db.prepare('SELECT id,active FROM auth_users WHERE email=?').get(email.trim().toLowerCase());
    if (!user) user = await auth.createUser(email, await readPassword(), role);
    else if (!user.active) throw new Error('この検証用アカウントは利用停止されています');
    if(role==='admin'){const {bootstrapVerificationAdmin}=await import('../lib/verification-account.ts');bootstrapVerificationAdmin(db,user.id);}
    const ids = seedVerification(db, user.id);
    console.log(`検証用環境を準備しました（サンプル${ids.length}件）。既存データとパスワードは上書きしていません。`);
    console.log('次に npm run verification:start を実行し、ログイン後に「検証ページ」を開いてください。');
  } else {
    if (!existsSync(database)) throw new Error('検証用DBがありません。先に verification:setup を実行してください');
    const port = process.env.PORT ?? '3300', host = process.env.SMILE_VERIFICATION_HOST ?? '127.0.0.1';
    if (!/^[0-9]+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('ポート番号が不正です');
    const production = process.argv.includes('--production');
    const origin = process.env.SMILE_VERIFICATION_ORIGIN ?? (production ? '' : `http://localhost:${port}`);
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('公開先の SMILE_VERIFICATION_ORIGIN を設定してください'); }
    if (parsed.origin !== origin || parsed.username || parsed.password || (production ? parsed.protocol !== 'https:' : !['https:', 'http:'].includes(parsed.protocol))) throw new Error('検証用Originが不正です。本番形式の起動にはHTTPSが必要です');
    const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', production ? 'start' : 'dev', '--hostname', host, '--port', port], {
      cwd: project, stdio: 'inherit', env: { ...process.env, APP_ORIGIN: origin },
    });
    process.on('SIGTERM', () => server.kill('SIGTERM'));
    process.on('SIGINT', () => server.kill('SIGINT'));
    server.on('error', () => { console.error('検証用サーバーを起動できませんでした'); process.exitCode = 1; });
    server.on('exit', code => { process.exitCode = code ?? 0; });
  }
} catch (error) {
  console.error(error?.name === 'AuthError' || error?.constructor === Error ? error.message : '検証環境を準備できませんでした。設定と専用ディレクトリを確認してください');
  process.exitCode = 1;
} finally { db?.close(); }
