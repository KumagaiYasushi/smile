import { getDb } from '@/lib/db';
import { privateJson } from '@/lib/auth-server';
import { TaskError } from '@/types/task';
import { createVenueStore } from '@/lib/venues';

export const venueStore = () => createVenueStore(getDb());
export async function venueResponse(action: () => unknown | Promise<unknown>, status = 200) {
  try { return privateJson(await action(), status); }
  catch (error) {
    if (error instanceof TaskError) return privateJson({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return privateJson({ error: '入力形式が不正です' }, 400);
    return privateJson({ error: '会場台帳の処理に失敗しました' }, 500);
  }
}
