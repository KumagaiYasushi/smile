'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [stage, setStage] = useState<'password' | 'setup' | 'mfa'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(stage === 'password' ? '/api/auth/login' : '/api/auth/mfa', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(stage === 'password' ? { email, password } : { code }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? 'ログインに失敗しました');
      setPassword('');
      if (result.stage === 'full') { window.location.assign('/'); return; }
      setStage(result.stage);
      setSecret(result.secret ?? '');
    } catch (error) {
      setError(error instanceof Error ? error.message : '通信に失敗しました');
    } finally { setBusy(false); }
  }

  return (
    <section className="max-w-md mx-auto bg-white border border-slate-200 rounded-2xl p-6 space-y-5">
      <h1 className="text-2xl font-bold text-slate-800">{stage === 'password' ? 'ログイン' : stage === 'setup' ? '認証アプリの登録' : '本人確認'}</h1>
      <p className="text-sm text-slate-600">運営メンバー専用です。アカウントの発行は管理者へ依頼してください。</p>
      {error && <p role="alert" className="text-sm text-red-700 bg-red-50 p-3 rounded-lg">{error}</p>}
      {stage === 'setup' && (
        <div className="space-y-3 text-sm text-slate-700">
          <p>認証アプリでアカウントを追加し、以下のセットアップキーを手動入力してください。登録後、アプリの6桁コードを入力してください。</p>
          <code className="block break-all bg-slate-100 p-3 rounded-lg select-all">{secret}</code>
          <p>このキーは第三者に共有しないでください。確認完了までは管理画面を利用できません。</p>
        </div>
      )}
      <form onSubmit={submit} className="space-y-4">
        {stage === 'password' ? <>
          <label className="block text-sm font-medium">メールアドレス
            <input type="email" autoComplete="username" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-3" />
          </label>
          <label className="block text-sm font-medium">パスワード
            <input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-3" />
          </label>
        </> : <label className="block text-sm font-medium">認証アプリの確認コード
          <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 p-3" />
        </label>}
        <button disabled={busy} className="w-full rounded-lg bg-sky-800 text-white p-3 font-bold disabled:opacity-50">{busy ? '確認中…' : stage === 'password' ? 'ログイン' : '確認する'}</button>
      </form>
      {stage !== 'password' && <button className="text-sm text-sky-700 underline" onClick={() => { setStage('password'); setSecret(''); setCode(''); setError(''); }}>ログインからやり直す</button>}
    </section>
  );
}
