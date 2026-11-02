import { getDb } from '@/lib/db';
import { createTaskStore } from '@/lib/tasks';
import { privateJson } from '@/lib/auth-server';
import { TaskError } from '@/types/task';

export const taskStore = () => createTaskStore(getDb());

export async function taskResponse(action: () => unknown | Promise<unknown>, status = 200) {
  try { return privateJson(await action(), status); }
  catch (error) {
    if (error instanceof TaskError) return privateJson({ error: error.message }, error.status);
    if (error instanceof SyntaxError) return privateJson({ error: '入力形式が不正です' }, 400);
    return privateJson({ error: 'タスクの処理に失敗しました' }, 500);
  }
}
