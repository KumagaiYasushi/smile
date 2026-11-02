import { getDb } from '@/lib/db';
import { privateJson } from '@/lib/auth-server';
import { TaskError } from '@/types/task';
import { createLunchStore } from '@/lib/lunch';

export const lunchStore = () => createLunchStore(getDb());
export async function lunchResponse(action: () => unknown | Promise<unknown>, status = 200) {
  try { return privateJson(await action(), status); }
  catch (error) {
    if (error instanceof TaskError) return privateJson({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return privateJson({ error: '入力形式が不正です' }, 400);
    return privateJson({ error: '昼食の処理に失敗しました' }, 500);
  }
}
