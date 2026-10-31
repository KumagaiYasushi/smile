import { authStore } from '../lib/local-auth.ts';

// Values are supplied only through the local environment, never command arguments/logs.
const { SMILE_DEV_EMAIL, SMILE_DEV_NAME, SMILE_DEV_PASSWORD } = process.env;
if (!SMILE_DEV_EMAIL || !SMILE_DEV_NAME || !SMILE_DEV_PASSWORD) {
  throw new Error('Set SMILE_DEV_EMAIL (.invalid), SMILE_DEV_NAME and SMILE_DEV_PASSWORD (12+ characters).');
}
authStore().createUser(SMILE_DEV_EMAIL, SMILE_DEV_NAME, SMILE_DEV_PASSWORD);
console.log('架空の開発管理者を作成しました。初回ログイン時に認証アプリを登録してください。');
