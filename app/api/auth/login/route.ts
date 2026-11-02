import { NextRequest } from 'next/server';
import { AuthError } from '@/lib/auth';
import { authStore, sameOrigin, privateJson, setAuthCookie, clearAuthCookies, SESSION_COOKIE, CHALLENGE_COOKIE } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: '送信元を確認できません' }, 403);
  try {
    const body = await request.json();
    if (!body || typeof body.email !== 'string' || typeof body.password !== 'string') {
      return privateJson({ error: 'メールアドレスとパスワードを入力してください' }, 400);
    }
    const store = authStore();
    const result = await store.login(body.email, body.password);
    store.logout(request.cookies.get(SESSION_COOKIE)?.value);
    store.logout(request.cookies.get(CHALLENGE_COOKIE)?.value);
    const response = privateJson({ stage: result.stage, secret: result.secret, uri: result.uri });
    clearAuthCookies(response);
    setAuthCookie(response, result.stage === 'full' ? SESSION_COOKIE : CHALLENGE_COOKIE, result.token);
    return response;
  } catch (error) {
    if (error instanceof AuthError) return privateJson({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return privateJson({ error: '入力形式が不正です' }, 400);
    return privateJson({ error: 'ログイン処理に失敗しました' }, 500);
  }
}
