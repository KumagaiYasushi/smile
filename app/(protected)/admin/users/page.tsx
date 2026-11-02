import { notFound } from 'next/navigation';
import { currentUser, authStore } from '@/lib/auth-server';

export default async function UsersPage() {
  const user = await currentUser();
  if (!user || user.role !== 'admin') notFound();
  const users = authStore().listUsers() as { id: number; email: string; role: string; active: number; mfa_enabled: number }[];
  return <section className="space-y-4">
    <h1 className="text-2xl font-bold text-slate-800">アカウント一覧</h1>
    <p className="text-sm text-slate-600">管理者は認証アプリの登録・確認後に利用できます。管理者アカウントは2名までです。</p>
    <ul className="space-y-3">{users.map((item) => <li key={item.id} className="rounded-xl border bg-white p-4 break-all">
      <p className="font-medium">{item.email}</p>
      <p className="text-sm text-slate-500">{item.role === 'admin' ? '管理者' : '運営メンバー'}・{item.active ? '有効' : '無効'}・MFA {item.mfa_enabled ? '登録済み' : '未登録'}</p>
    </li>)}</ul>
  </section>;
}
