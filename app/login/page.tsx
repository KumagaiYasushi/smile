'use client';

import { useState, type FormEvent } from 'react';

export default function LoginPage() {
  const [mfa, setMfa] = useState(false);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch(`/api/auth/${mfa ? 'mfa' : 'login'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mfa ? { code: form.get('code') } : { email: form.get('email'), password: form.get('password') }),
      });
      const data = await response.json();
      if (!response.ok) { setError(data.error); return; }
      if (mfa) { window.location.assign('/'); return; }
      setSecret(data.setupSecret);
      setMfa(true);
    } catch { setError('通信に失敗しました。もう一度お試しください。'); }
    finally { setBusy(false); }
  }

  return (
    <section className="max-w-md mx-auto rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
      <p className="text-xs font-bold text-sky-700 mb-2">歯周基本治療研究会</p>
      <h1 className="text-2xl font-bold text-slate-800">{mfa ? '管理者の本人確認' : '企画運営管理システム'}</h1>
      <p className="text-sm text-slate-600 mt-3 mb-6">開発検証用です。架空の管理者アカウントでログインしてください。</p>
      {secret && <div className="rounded-lg bg-sky-50 p-4 mb-5 text-sm text-slate-800">
        <p>初回設定：認証アプリに次のキーを登録してください（時間ベース・6桁・30秒）。</p>
        <code className="block break-all select-all font-bold mt-3">{secret}</code>
        <p className="mt-2">キーを他人と共有しないでください。</p>
      </div>}
      <form onSubmit={submit} className="space-y-5">
        {mfa ? <label className="block text-sm font-medium">認証アプリの6桁コード
          <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className="mt-2 w-full rounded-lg border border-slate-300 p-3" />
        </label> : <>
          <label className="block text-sm font-medium">メールアドレス
            <input name="email" type="email" autoComplete="username" required maxLength={254} className="mt-2 w-full rounded-lg border border-slate-300 p-3" />
          </label>
          <label className="block text-sm font-medium">パスワード
            <input name="password" type="password" autoComplete="current-password" required maxLength={256} className="mt-2 w-full rounded-lg border border-slate-300 p-3" />
          </label>
        </>}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        <button disabled={busy} className="w-full rounded-lg bg-sky-800 p-3 text-white font-bold disabled:opacity-50">{busy ? '確認中…' : mfa ? '確認してログイン' : 'ログイン'}</button>
      </form>
      {mfa && <button onClick={() => { setMfa(false); setSecret(null); setError(''); }} className="mt-5 text-sm text-sky-700 underline">ログインからやり直す</button>}
    </section>
  );
}
