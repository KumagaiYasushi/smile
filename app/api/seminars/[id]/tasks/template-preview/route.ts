import { NextRequest } from 'next/server';
import { requireMember } from '@/lib/auth-server';
import { taskResponse } from '@/lib/task-server';
import { generationInput, templateStore } from '@/lib/template-server';
import { parseId } from '@/types/task';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireMember(request); if (denied) return denied;
  return taskResponse(async () => {
    const input = generationInput(await request.json());
    return { preview: templateStore().preview(parseId((await params).id), input.baseDate) };
  });
}
