import { eventPageStore } from '@/lib/event-page';
import { TemplateEditor } from '@/components/EventForms';
export default async function TemplatesPage() {
  const store = await eventPageStore();
  return <div><h1 className="text-2xl font-bold mb-3">標準タスクテンプレート</h1><p className="text-slate-600 mb-6">研究会の運営実績に合わせて項目と期限日数を登録します。講演会とセミナーは共通のテンプレートです。</p><TemplateEditor templates={store.templates()} /></div>;
}
