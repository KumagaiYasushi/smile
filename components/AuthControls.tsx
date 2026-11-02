'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function AuthControls({ role, verification = false }: { role: 'member' | 'admin'; verification?: boolean }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error();
      window.location.assign('/login');
    } catch { setError('ログアウトに失敗しました。もう一度お試しください。'); setBusy(false); }
  }
  return <div data-app-chrome className="mb-6 flex flex-wrap items-center gap-4 text-sm">
    <span className="text-slate-500">{role === 'admin' ? '管理者' : '運営メンバー'}</span>
    {verification && <Link href="/verification" className="text-sky-800 underline font-bold">検証ページ</Link>}
    <Link href="/home" className="text-sky-800 underline font-bold">HOME</Link>
    <Link href="/" className="text-sky-800 underline">イベント一覧</Link>
    <Link href="/dashboard" className="text-sky-800 underline">ダッシュボード</Link>
    <Link href="/seminars/new" className="rounded-lg bg-sky-800 px-4 py-2 text-white font-bold">＋ 新規イベント</Link>
    <Link href="/task-templates" className="text-sky-800 underline">タスクテンプレート</Link>
    <Link href="/venues" className="text-sky-800 underline">会場台帳</Link>
    <Link href="/society-members" className="text-sky-800 underline">講師・サポート名簿</Link>
    <Link href="/external-lecturers" className="text-sky-800 underline">外来講師リスト</Link>
    {role === 'admin' && <Link href="/admin/users" className="text-sky-800 underline">アカウント一覧</Link>}
    <button onClick={logout} disabled={busy} className="text-sky-800 underline">ログアウト</button>
    {error && <p role="alert" className="text-red-700">{error}</p>}
  </div>;
}
