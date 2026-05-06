import { NextRequest, NextResponse } from 'next/server';
import { getSeminarById, updateSeminar, deleteSeminar } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const seminar = getSeminarById(Number(id));
  if (!seminar) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
  return NextResponse.json(seminar);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  try {
    const body = await request.json();
    const updated = updateSeminar(Number(id), body);
    if (!updated) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const deleted = deleteSeminar(Number(id));
  if (!deleted) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
  return NextResponse.json({ success: true });
}
