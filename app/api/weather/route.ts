import { NextRequest } from 'next/server';
import { requireMember, privateJson } from '@/lib/auth-server';
import { getAllSeminars } from '@/lib/db';
import { createJmaClient, eventWeather } from '@/lib/weather';
const client = createJmaClient();

export async function GET(request: NextRequest) {
  const denied = await requireMember(request); if (denied) return denied;
  try { return privateJson(await eventWeather(getAllSeminars(), client)); }
  catch { return privateJson({ error: '天気予報を取得できませんでした' }, 503); }
}
