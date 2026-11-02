import { NextRequest, NextResponse } from 'next/server';
import { getAllSeminars, createSeminar } from '@/lib/db';
import { isEventType, isDeliveryMethod } from '@/types/seminar';
import { currentUser, requireMember } from '@/lib/auth-server';
import { templateStore } from '@/lib/template-server';
import { TaskError } from '@/types/task';
import { requireDate } from '@/types/task-template';
import { emptySocialGathering, parseSocialGathering } from '@/types/social-gathering';

export async function GET(request: NextRequest) {
  const denied = await requireMember(request);
  if (denied) return denied;
  try {
    const seminars = getAllSeminars();
    return NextResponse.json(seminars);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const denied = await requireMember(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new TaskError('入力形式が不正です');
    if (body.event_type !== undefined && !isEventType(body.event_type)) {
      return NextResponse.json({ error: 'イベント種別が不正です' }, { status: 400 });
    }
    if ('delivery_method' in body && !isDeliveryMethod(body.delivery_method)) throw new TaskError('開催方法が不正です');
    if (body.generate_tasks !== undefined && typeof body.generate_tasks !== 'boolean') throw new TaskError('タスク自動生成の指定が不正です');
    const baseDate = body.task_base_date === undefined ? undefined : requireDate(body.task_base_date);
    const gathering = body.social_gathering === undefined ? emptySocialGathering() : parseSocialGathering(body.social_gathering);
    const actor = await currentUser(); if (!actor) throw new TaskError('ログインが必要です', 401);
    const seminar = templateStore().createEvent(() => createSeminar({
      event_type: body.event_type ?? 'SEMINAR',
      delivery_method: body.delivery_method ?? null,
      social_gathering: gathering,
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
      venue_id: body.venue_id === undefined ? null : body.venue_id,
      venue_fee: Number(body.venue_fee) || 0,
      sns_announcement: body.sns_announcement ?? '',
      lecturer_invitation_sent: Boolean(body.lecturer_invitation_sent),
      photo_received: Boolean(body.photo_received),
      abstract_300_requested: Boolean(body.abstract_300_requested),
      abstract_800_requested: Boolean(body.abstract_800_requested),
      receipt_issued: Boolean(body.receipt_issued),
      notes: body.notes ?? '',
    }), actor.id, body.generate_tasks ?? true, baseDate);
    return NextResponse.json(seminar, { status: 201 });
  } catch (error) {
    if (error instanceof TaskError) return NextResponse.json({ error: error.message }, { status: error.status });
    if (error instanceof SyntaxError) return NextResponse.json({ error: '入力形式が不正です' }, { status: 400 });
    console.error(error);
    return NextResponse.json({ error: 'サーバーエラーが発生しました' }, { status: 500 });
  }
}
