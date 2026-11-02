import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/auth';
import { authStore, requireMember, privateJson, currentUser } from '@/lib/auth-server';

export async function GET(request: NextRequest) {
  const denied = await requireMember(request, 'admin');
  if (denied) return denied;
  return privateJson({ users: authStore().listUsers() });
}

export async function POST(request: NextRequest) {
  const denied = await requireMember(request, 'admin');
  if (denied) return denied;
  try {
    const body = await request.json();
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string' || !['admin', 'member'].includes(body.role)) {
      return privateJson({ error: 'メールアドレス・パスワード・権限を確認してください' }, 400);
    }
    const actor = await currentUser();
    const user = await authStore().createUser(body.email, body.password, body.role, actor!.id);
    return privateJson({ user }, 201);
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return privateJson({ error: '入力形式が不正です' }, 400);
    return privateJson({ error: '作成に失敗しました。既存アカウントと設定を確認してください' }, 409);
  }
}
