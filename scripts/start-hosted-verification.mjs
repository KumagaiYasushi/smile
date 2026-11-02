import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostedVerificationSettings } from '../lib/hosted-verification.ts';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let child, stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { stopping = true; child?.kill(signal); });
try {
  const { email, password, runtime } = hostedVerificationSettings(process.env);
  child = spawn(process.execPath, ['scripts/verification.mjs', 'setup', email], { cwd: project,
    env: runtime, stdio: ['pipe', 'inherit', 'inherit'] });
  child.stdin.on('error', () => {});
  child.stdin.end(JSON.stringify({ password }));
  const [setupCode] = await once(child, 'exit');
  if (setupCode !== 0 || stopping) throw new Error('検証用データの準備を完了できませんでした');
  child = spawn(process.execPath, ['scripts/verification.mjs', 'start', '--production'], {
    cwd: project, env: runtime, stdio: 'inherit',
  });
  const [code] = await once(child, 'exit'); process.exitCode = code ?? 1;
} catch {
  // Never dump environment values, stdin, credentials or child-process errors.
  console.error('検証用サービスを起動できませんでした。公開先のメール・パスワード・HTTPS URL・専用保存先を確認してください。');
  process.exitCode = 1;
}
