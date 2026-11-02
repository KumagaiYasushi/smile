import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, openSync, fchmodSync, closeSync } from 'node:fs';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (process.env.NODE_ENV === 'production') throw new Error('本番キーは安全な環境設定で管理してください');
if (process.env.AUTH_MFA_KEY) {
  console.log('AUTH_MFA_KEY は設定済みです。既存キーを保持します。');
} else {
  const descriptor = openSync('.env.local', 'a', 0o600);
  try {
    fchmodSync(descriptor, 0o600);
    appendFileSync(descriptor, `\nAUTH_MFA_KEY=${randomBytes(32).toString('hex')}\n`);
  } finally { closeSync(descriptor); }
  console.log('開発用MFA暗号化キーを .env.local に保存しました。内容は共有・コミットせず、サーバーを再起動してください。');
}
