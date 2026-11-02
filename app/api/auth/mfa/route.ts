import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/auth';
import { authStore, sameOrigin, privateJson, setAuthCookie, clearAuthCookies, SESSION_COOKIE, CHALLENGE_COOKIE } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: '送信元を確認できません' }, 403);
  try {
    const body = await request.json();
    if (!body || typeof body.code !== 'string') return privateJson({ error: '確認コードを入力してください' }, 400);
    const token = authStore().verifyMfa(request.cookies.get(CHALLENGE_COOKIE)?.value, body.code);
    const response = privateJson({ stage: 'full' });
    clearAuthCookies(response);
    setAuthCookie(response, SESSION_COOKIE, token);
    return response;
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return privateJson({ error: '入力形式が不正です' }, 400);
    return privateJson({ error: '確認処理に失敗しました' }, 500);
  }
}
