import { NextRequest } from 'next/server';
import { requireMember, privateJson } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  const denied = await requireMember(request); if (denied) return denied;
  return privateJson({ error: 'テンプレートからのタスク生成は停止しています。タスクを個別に追加してください。' }, 410);
}
