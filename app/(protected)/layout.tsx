import { redirect } from 'next/navigation';
import Link from 'next/link';
import { currentIdentity } from '@/lib/auth';
import LogoutButton from '@/components/LogoutButton';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const identity = await currentIdentity();
  if (!identity) redirect('/login');
  return <>
    <nav aria-label="メインメニュー" className="flex flex-wrap items-center gap-4 mb-6 text-sky-800">
      <Link href="/" className="font-bold">ホーム</Link>
      <Link href="/events">イベント</Link>
      <Link href="/task-templates">標準タスク</Link>
      <Link href="/participants">参加者マスター</Link>
      <Link href="/seminars">旧セミナー管理</Link>
      <span className="ml-auto text-sm">{identity.name}（管理者）</span>
      <LogoutButton />
    </nav>
    {children}
  </>;
}
