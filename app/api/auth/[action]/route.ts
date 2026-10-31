import { NextRequest, NextResponse } from 'next/server';
import { authStore, CHALLENGE_COOKIE, SESSION_COOKIE, sameOrigin } from '@/lib/auth';

export async function POST(request: NextRequest, { params }: { params: Promise<{ action: string }> }) {
  const { action } = await params;
  if (!['login', 'mfa', 'logout'].includes(action)) return new NextResponse(null, { status: 404 });
  if (!sameOrigin(request)) return NextResponse.json({ error: '許可されていないリクエストです' }, { status: 403 });
  const options = { httpOnly: true, sameSite: 'strict' as const, secure: request.nextUrl.protocol === 'https:', path: '/' };
  const result = NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  const store = authStore();
  if (action === 'logout') {
    store.logout(request.cookies.get(SESSION_COOKIE)?.value ?? '');
    result.cookies.set(SESSION_COOKIE, '', { ...options, maxAge: 0 });
    result.cookies.set(CHALLENGE_COOKIE, '', { ...options, maxAge: 0 });
    return result;
  }
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: '入力を確認してください' }, { status: 400 }); }
  if (!body || typeof body !== 'object') return NextResponse.json({ error: '入力を確認してください' }, { status: 400 });
  if (action === 'login') {
    if (typeof body.email !== 'string' || typeof body.password !== 'string' || body.email.length > 254 || body.password.length > 256) {
      return NextResponse.json({ error: '入力を確認してください' }, { status: 400 });
    }
    const challenge = store.login(body.email, body.password);
    if (!challenge) return NextResponse.json({ error: 'ログインできません。入力内容を確認するか、時間をおいて再試行してください。' }, { status: 401 });
    const response = NextResponse.json({ mfaRequired: true, setupSecret: challenge.setupSecret }, { headers: { 'Cache-Control': 'no-store' } });
    response.cookies.set(CHALLENGE_COOKIE, challenge.token, { ...options, maxAge: 300 });
    return response;
  }
  const token = typeof body.code === 'string' && /^\d{6}$/.test(body.code)
    ? store.verifyMfa(request.cookies.get(CHALLENGE_COOKIE)?.value ?? '', body.code) : null;
  if (!token) return NextResponse.json({ error: 'コードを確認してください。有効期限切れの場合はログインからやり直してください。' }, { status: 401 });
  result.cookies.set(CHALLENGE_COOKIE, '', { ...options, maxAge: 0 });
  result.cookies.set(SESSION_COOKIE, token, { ...options, maxAge: 28800 });
  return result;
}
