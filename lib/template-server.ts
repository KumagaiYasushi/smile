import { getDb } from '@/lib/db';
import { createTemplateStore } from '@/lib/task-templates';

export const templateStore = () => createTemplateStore(getDb());
