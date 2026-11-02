import { currentUser, privateJson } from '@/lib/auth-server';

export async function GET() {
  const user = await currentUser();
  return user ? privateJson({ user }) : privateJson({ error: 'ログインが必要です' }, 401);
}
