import { NextRequest, NextResponse } from 'next/server';
import { getAllSeminars, createSeminar } from '@/lib/db';

export async function GET() {
  try {
    const seminars = getAllSeminars();
    return NextResponse.json(seminars);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const seminar = createSeminar({
      name: body.name ?? '',
      dates: body.dates ?? [],
      content: body.content ?? '',
      lecturer_name: body.lecturer_name ?? '',
      assistant_members: body.assistant_members ?? [],
      fee_dental_hygienist: Number(body.fee_dental_hygienist) || 0,
      fee_dentist: Number(body.fee_dentist) || 0,
      fee_other: Number(body.fee_other) || 0,
      target_participants: body.target_participants ?? '',
      venue: body.venue ?? '',
      venue_fee: Number(body.venue_fee) || 0,
      sns_announcement: body.sns_announcement ?? '',
      lecturer_invitation_sent: Boolean(body.lecturer_invitation_sent),
      photo_received: Boolean(body.photo_received),
      abstract_300_requested: Boolean(body.abstract_300_requested),
      abstract_800_requested: Boolean(body.abstract_800_requested),
      receipt_issued: Boolean(body.receipt_issued),
      notes: body.notes ?? '',
    });
    return NextResponse.json(seminar, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
