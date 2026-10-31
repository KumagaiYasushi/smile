import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { authStore } from './local-auth.ts';
export { authStore } from './local-auth.ts';

export const SESSION_COOKIE = 'smile_session';
export const CHALLENGE_COOKIE = 'smile_mfa';


export async function currentIdentity() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? authStore().session(token) : null;
}

export function sameOrigin(request: Request) {
  // Next's internal URL can use localhost even when the browser used 127.0.0.1.
  // Use the actual Host, and never accept a forwarded host from the caller.
  const host = request.headers.get('host');
  return !!host && request.headers.get('origin') === `${new URL(request.url).protocol}//${host}`;
}

export async function denyUnauthenticated(request?: Request) {
  if (!await currentIdentity()) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  if (request && !['GET', 'HEAD'].includes(request.method) && !sameOrigin(request)) {
    return NextResponse.json({ error: '許可されていないリクエストです' }, { status: 403 });
  }
  return null;
}
