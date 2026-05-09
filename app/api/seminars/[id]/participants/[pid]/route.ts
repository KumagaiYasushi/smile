import { NextRequest, NextResponse } from 'next/server';
import { getParticipantById, updateParticipant, deleteParticipant } from '@/lib/db';

type Params = { params: Promise<{ id: string; pid: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { pid } = await params;
  const p = getParticipantById(Number(pid));
  if (!p) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
  return NextResponse.json(p);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { pid } = await params;
  try {
    const body = await request.json();
    const updated = updateParticipant(Number(pid), body);
    if (!updated) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { pid } = await params;
  const deleted = deleteParticipant(Number(pid));
  if (!deleted) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
  return NextResponse.json({ success: true });
}
