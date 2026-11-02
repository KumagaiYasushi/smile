import { NextRequest, NextResponse } from 'next/server';
import { getSeminarById, updateSeminar, deleteSeminar } from '@/lib/db';
import { isEventType, isDeliveryMethod } from '@/types/seminar';
import { requireMember } from '@/lib/auth-server';
import { TaskError } from '@/types/task';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const denied = await requireMember(_req);
  if (denied) return denied;
  const { id } = await params;
  const seminar = getSeminarById(Number(id));
  if (!seminar) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
  return NextResponse.json(seminar);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request);
  if (denied) return denied;
  const { id } = await params;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TaskError('入力形式が不正です');
    if ('dates' in body) {
      const current = getSeminarById(Number(id));
      if (!current) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
      if (JSON.stringify(current.dates) !== JSON.stringify(body.dates)) throw new TaskError('開催日の変更は「開催日・期限変更」からプレビューして確定してください', 409);
    }
    if (body.event_type !== undefined && !isEventType(body.event_type)) {
      return NextResponse.json({ error: 'イベント種別が不正です' }, { status: 400 });
    }
    if ('delivery_method' in body && !isDeliveryMethod(body.delivery_method)) throw new TaskError('開催方法が不正です');
    const updated = updateSeminar(Number(id), body);
    if (!updated) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    if (error instanceof TaskError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: '入力形式が不正です' }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const denied = await requireMember(_req);
  if (denied) return denied;
  const { id } = await params;
  const deleted = deleteSeminar(Number(id));
  if (!deleted) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
  return NextResponse.json({ success: true });
}
