import { getDb } from '@/lib/db';
import { privateJson } from '@/lib/auth-server';
import { TaskError } from '@/types/task';
import { createStaffAttendanceStore } from '@/lib/staff-attendance';

export const staffAttendanceStore = () => createStaffAttendanceStore(getDb());
export async function staffAttendanceResponse(action: () => unknown | Promise<unknown>, status = 200) {
  try { return privateJson(await action(), status); }
  catch (error) {
    if (error instanceof TaskError) return privateJson({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return privateJson({ error: '入力形式が不正です' }, 400);
    return privateJson({ error: '出欠予定の処理に失敗しました' }, 500);
  }
}
