import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostedVerificationSettings, HostedVerificationConfigError } from '../lib/hosted-verification.ts';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let child, stopping = false, phase = '設定の確認';
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; child?.kill(signal); });
try {
  const { email, password, role, runtime } = hostedVerificationSettings(process.env);
  phase = 'サンプルデータの準備';
  child = spawn(process.execPath, ['scripts/verification.mjs', 'setup', email, `--role=${role}`], { cwd: project,
    env: runtime, stdio: ['pipe', 'inherit', 'inherit'] });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify({ password }));
  const [setupCode] = await once(child, 'exit');
  if (setupCode !== 0 || stopping) throw new Error('検証用データの準備を完了できませんでした');
  phase = 'Webサーバーの起動';
  child = spawn(process.execPath, ['scripts/verification.mjs', 'start', '--production'], {
    cwd: project, env: runtime, stdio: 'inherit',
  });
  const [code] = await once(child, 'exit'); process.exitCode = code ?? 1;
} catch (error) {
  // Never dump environment values, stdin, credentials or child-process errors.
  console.error(error instanceof HostedVerificationConfigError
    ? `起動設定エラー: ${error.message}`
    : `検証用サービスの「${phase}」に失敗しました。直前のログを確認してください。`);
  process.exitCode = 1;
}
