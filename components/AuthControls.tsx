'use client';

import {usePathname} from 'next/navigation';
import { useState } from 'react';
import Link from 'next/link';

export default function AuthControls({ role, verification = false }: { role: 'member' | 'admin'; verification?: boolean }) {
  const pathname=usePathname();
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
  const eventPage=/^\/seminars\/[1-9]\d*(?:\/|$)/.test(pathname);
  return <details data-app-chrome open={!eventPage} className="mb-6 rounded-xl border border-slate-200 bg-white p-3">
    <summary className="cursor-pointer text-sm font-bold text-slate-700">システム全体のメニュー <span className="ml-2 text-xs font-normal text-slate-500">{role==='admin'?'管理者':'運営メンバー'}</span></summary>
    <nav aria-label="システムメニュー" className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {verification&&<Link href="/verification" className="rounded-lg bg-slate-50 p-3 text-sm text-sky-800">検証ページ</Link>}
      {[['/home','HOME'],['/','イベント一覧'],['/dashboard','ダッシュボード'],['/seminars/new','＋ 新規イベント'],['/task-templates','タスクテンプレート'],['/venues','会場台帳'],['/society-members','講師・サポート名簿'],['/external-lecturers','外部講師リスト'],['/gmail','Gmail連携'],...(role==='admin'?[['/admin/users','アカウント一覧']]:[])].map(([href,label])=><Link key={href} href={href} aria-current={pathname===href?'page':undefined} className={`rounded-lg p-3 text-sm ${pathname===href?'bg-sky-800 font-bold text-white':'bg-slate-50 text-sky-800 hover:bg-sky-50'}`}>{label}</Link>)}
      <button onClick={logout} disabled={busy} className="rounded-lg bg-slate-50 p-3 text-left text-sm text-sky-800">ログアウト</button>
    </nav>{error&&<p role="alert" className="mt-3 text-red-700">{error}</p>}
  </details>;
}
