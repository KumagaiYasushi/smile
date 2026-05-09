import { NextRequest, NextResponse } from 'next/server';
import { getParticipantsBySeminar, createParticipant, getSeminarById } from '@/lib/db';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const seminar = getSeminarById(Number(id));
  if (!seminar) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
  return NextResponse.json(getParticipantsBySeminar(Number(id)));
}

export async function POST(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const seminar = getSeminarById(Number(id));
  if (!seminar) return NextResponse.json({ error: '見つかりません' }, { status: 404 });
  try {
    const body = await request.json();
    const participant = createParticipant({
      seminar_id: Number(id),
      name: body.name ?? '',
      role: body.role ?? 'other',
      email: body.email ?? '',
      phone: body.phone ?? '',
      payment_status: body.payment_status ?? 'unpaid',
      attended: Boolean(body.attended),
      receipt_number: body.receipt_number ?? '',
      notes: body.notes ?? '',
    });
    return NextResponse.json(participant, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'サーバーエラー' }, { status: 500 });
  }
}
