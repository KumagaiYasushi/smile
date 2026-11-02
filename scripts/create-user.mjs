import { existsSync } from 'node:fs';
import { getDb } from '../lib/db.ts';
import { createAuthStore } from '../lib/auth.ts';
import { readPassword } from './password-input.mjs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const [email, role = 'member'] = process.argv.slice(2);
if (!email || !['admin', 'member'].includes(role)) {
  console.error('Usage: npm run user:create -- <email> <admin|member>');
  process.exit(1);
}

try {
  await createAuthStore(getDb(), process.env.AUTH_MFA_KEY).createUser(email, await readPassword(), role);
  console.log(role === 'admin' ? '管理者を作成しました。初回ログインで認証アプリを登録してください。' : '運営メンバーを作成しました。');
} catch (error) {
  // Do not dump SQLite errors, credentials or user input.
  console.error(error?.name === 'AuthError' ? error.message : 'アカウントを作成できませんでした。入力・既存アカウント・設定を確認してください。');
  process.exitCode = 1;
} finally { getDb().close(); }
