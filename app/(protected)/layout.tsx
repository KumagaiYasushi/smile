import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth-server';
import AuthControls from '@/components/AuthControls';

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const verification = process.env.SMILE_VERIFICATION_MODE === '1';
  const ephemeral = process.env.SMILE_VERIFICATION_EPHEMERAL === '1';
  return <>{verification && <p data-app-chrome className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">検証用環境です。架空データで操作をお試しください。
    {ephemeral && '一時保存のため、再起動・再配置で編集内容が失われる場合があります。'}</p>}
    <div className="app-shell grid min-w-0 grid-cols-1 items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-6">
      <AuthControls role={user.role} verification={verification} />
      <div role="region" aria-label="表示・入力エリア" className="app-workspace min-w-0 max-w-full rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div data-app-chrome className="flex items-center gap-2 rounded-t-2xl border-b border-slate-200 bg-slate-50 px-4 py-3"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-sky-600"/><p className="text-xs font-bold tracking-wide text-slate-600">表示・入力エリア</p></div>
        <div className="app-workspace-content min-w-0 p-3 sm:p-5 lg:p-6">{children}</div>
      </div>
    </div></>;
}
