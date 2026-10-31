#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo 'Node.js 24 を https://nodejs.org/ からインストールし、ターミナルを開き直してください。'
  exit 1
fi
node -e 'if (Number(process.versions.node.split(".")[0]) !== 24) { console.error("この検証版はNode.js 24を使用してください。"); process.exit(1); }'
if [ "${SMILE_REVIEW_CHECK_ONLY:-}" = '1' ]; then
  echo 'Node.js 24・npmと検証フォルダーを確認しました。'
  exit 0
fi
npm ci --no-audit --no-fund
export SMILE_ENV=development
export SMILE_DEV_EMAIL=review-admin@example.invalid
export SMILE_DEV_NAME=架空の確認管理者

if node --experimental-strip-types --input-type=module -e 'import { authStore } from "./lib/local-auth.ts"; import { getDb } from "./lib/db.ts"; authStore(); const db=getDb(); const exists=db.prepare("SELECT 1 FROM users WHERE email=?").get("review-admin@example.invalid"); db.close(); process.exit(exists ? 0 : 1);'; then
  echo '作成済みの確認用管理者を使用します。以前設定したパスワードと認証アプリを使用してください。'
else
  echo '架空の確認用管理者を作成します。実際のサービスのパスワードは使わないでください。'
  read -r -s -p '確認用パスワードを12文字以上で入力（入力文字は表示されません）: ' SMILE_DEV_PASSWORD
  echo
  export SMILE_DEV_PASSWORD
  npm run dev:admin
  unset SMILE_DEV_PASSWORD
fi
echo '起動後に Ready と表示されたら、Macのブラウザーで http://127.0.0.1:3000/login を開いてください。'
echo '確認用メールアドレス: review-admin@example.invalid'
echo '終了するときはこのターミナルで Control+C を押してください。'
npm run dev -- --hostname 127.0.0.1 --port 3000
