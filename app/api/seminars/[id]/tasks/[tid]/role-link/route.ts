import { NextRequest } from 'next/server';
import { currentUser, requireMember } from '@/lib/auth-server';
import { getDb } from '@/lib/db';
import { createTaskRoleLinkStore } from '@/lib/task-role-links';
import { taskResponse } from '@/lib/task-server';
import { parseId } from '@/types/task';
type Context = { params: Promise<{ id: string; tid: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  const denied = await requireMember(request); if (denied) return denied;
  return taskResponse(async () => {
    const p = await params, id = parseId(p.id), db = getDb();
    const link = createTaskRoleLinkStore(db).read(id, parseId(p.tid));
    return { link, dates: JSON.parse((db.prepare('SELECT dates FROM seminars WHERE id=?').get(id) as { dates: string }).dates) };
  });
}
export async function PUT(request: NextRequest, { params }: Context) {
  const denied = await requireMember(request); if (denied) return denied;
  return taskResponse(async () => {
    const p = await params;
    return { link: createTaskRoleLinkStore(getDb()).save(parseId(p.id), parseId(p.tid), await request.json(), (await currentUser())!.id) };
  });
}
