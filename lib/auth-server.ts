import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { createAuthStore, AUTH_SESSION_SECONDS, AUTH_CHALLENGE_SECONDS } from '@/lib/auth';

export const SESSION_COOKIE = 'smile_session';
export const CHALLENGE_COOKIE = 'smile_challenge';
export const authStore = () => createAuthStore(getDb(), process.env.AUTH_MFA_KEY);

export async function currentUser() {
  return authStore().getUser((await cookies()).get(SESSION_COOKIE)?.value);
}

export function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Vary': 'Cookie' } });
}

export function sameOrigin(request: NextRequest) {
  const expected = process.env.APP_ORIGIN ?? request.nextUrl.origin;
  return request.headers.get('origin') === expected;
}

export async function requireMember(request: NextRequest, role?: 'admin') {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !sameOrigin(request)) {
    return privateJson({ error: '送信元を確認できません' }, 403);
  }
  const user = await currentUser();
  if (!user) return privateJson({ error: 'ログインが必要です' }, 401);
  if (role && user.role !== role) return privateJson({ error: '管理者権限が必要です' }, 403);
  return null;
}

export function setAuthCookie(response: NextResponse, name: typeof SESSION_COOKIE | typeof CHALLENGE_COOKIE, token: string) {
  response.cookies.set(name, token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
    path: '/', maxAge: name === SESSION_COOKIE ? AUTH_SESSION_SECONDS : AUTH_CHALLENGE_SECONDS });
}

export function clearAuthCookies(response: NextResponse) {
  for (const name of [SESSION_COOKIE, CHALLENGE_COOKIE]) {
    response.cookies.set(name, '', { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 0 });
  }
}
