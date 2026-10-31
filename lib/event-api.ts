import { NextResponse } from 'next/server';
import { currentIdentity, denyUnauthenticated } from './auth.ts';
import { getDb } from './db.ts';
import { EventError, EventStore } from './event-store.ts';

export function routeId(value: string) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new EventError('IDが不正です');
  return Number(value);
}
export async function eventApi(request: Request, run: (store: EventStore, actor: number) => unknown | Promise<unknown>, status = 200) {
  const denied = await denyUnauthenticated(request);
  if (denied) return denied;
  try {
    const identity = await currentIdentity();
    if (!identity) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
    const data = await run(new EventStore(getDb()), identity.id);
    return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof EventError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: '入力形式を確認してください' }, { status: 400 });
    return NextResponse.json({ error: '処理を完了できませんでした' }, { status: 500 });
  }
}
