import { NextRequest, NextResponse } from 'next/server';
import { getParticipantById, updateParticipant, deleteParticipant } from '@/lib/db';
import { requireMember } from '@/lib/auth-server';

type Params = { params: Promise<{ id: string; pid: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const denied = await requireMember(_req);
  if (denied) return denied;
  const { id, pid } = await params;
  const p = getParticipantById(Number(pid));
  if (!p || p.seminar_id !== Number(id)) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
  return NextResponse.json(p);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const denied = await requireMember(request);
  if (denied) return denied;
  const { id, pid } = await params;
  const participant = getParticipantById(Number(pid));
  if (!participant || participant.seminar_id !== Number(id)) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
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
  const denied = await requireMember(_req);
  if (denied) return denied;
  const { id, pid } = await params;
  const participant = getParticipantById(Number(pid));
  if (!participant || participant.seminar_id !== Number(id)) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
  const deleted = deleteParticipant(Number(pid));
  if (!deleted) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
  return NextResponse.json({ success: true });
}
