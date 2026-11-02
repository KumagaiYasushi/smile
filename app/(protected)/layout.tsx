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
    <AuthControls role={user.role} verification={verification} />{children}</>;
}
