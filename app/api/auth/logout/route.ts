import { NextRequest } from 'next/server';
import { authStore, sameOrigin, privateJson, clearAuthCookies, SESSION_COOKIE, CHALLENGE_COOKIE } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return privateJson({ error: '送信元を確認できません' }, 403);
  const store = authStore();
  store.logout(request.cookies.get(SESSION_COOKIE)?.value);
  store.logout(request.cookies.get(CHALLENGE_COOKIE)?.value);
  const response = privateJson({ success: true });
  clearAuthCookies(response);
  return response;
}
