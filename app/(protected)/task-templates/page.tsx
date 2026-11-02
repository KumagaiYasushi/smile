'use client';

import { useEffect, useState } from 'react';
import { EVENT_TYPE_LABELS } from '@/types/seminar';
import type { EventType } from '@/types/seminar';
import type { TaskTemplate, TemplateInput } from '@/types/task-template';
import { apiJson } from '@/lib/client-api';

const fieldClass = 'mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2';

function TemplateEditor({ initial, type, onSave, onCancel }: { initial: TaskTemplate | null; type: EventType; onSave: (body: TemplateInput) => Promise<void>; onCancel: () => void }) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [days, setDays] = useState(initial ? String(initial.relative_days) : '');
  const [important, setImportant] = useState(initial?.important ?? false);
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try { await onSave({ event_type: initial?.event_type ?? type, title, description, relative_days: Number(days), important, active }); }
    catch (error) { setError(error instanceof Error ? error.message : '保存に失敗しました'); }
    finally { setSaving(false); }
  }
  return <form onSubmit={save} className="space-y-4 rounded-xl border border-sky-200 bg-white p-5 text-sm" aria-label="テンプレート編集">
    <h2 className="text-lg font-bold">{initial ? 'テンプレートを編集' : 'テンプレートを追加'}：{EVENT_TYPE_LABELS[initial?.event_type ?? type]}</h2>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <label className="block">タスク名（必須）<input required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} className={fieldClass} /></label>
    <label className="block">説明<textarea aria-label="説明" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className={fieldClass} /></label>
    <label className="block">基準日からの日数<input type="number" required min={-3650} max={3650} step={1} value={days} onChange={(e) => setDays(e.target.value)} className={fieldClass} /></label>
    <p className="text-slate-500">開催前はマイナス、当日は0、開催後はプラス。例：30日前は -30、7日後は 7。</p>
    <label className="flex items-center gap-2"><input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} />重要タスク</label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />タスク生成で使用する</label>
    <div className="flex gap-3"><button disabled={saving} className="rounded-lg bg-sky-800 px-5 py-2 text-white">{saving ? '保存中…' : '保存する'}</button><button type="button" disabled={saving} onClick={onCancel} className="rounded-lg border px-5 py-2">キャンセル</button></div>
  </form>;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [type, setType] = useState<EventType>('SEMINAR');
  const [editing, setEditing] = useState<TaskTemplate | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    apiJson('/api/task-templates', { signal: controller.signal }).then((data) => { setTemplates(data.templates); setLoading(false); })
      .catch((error) => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, []);
  async function refresh() { setTemplates((await apiJson('/api/task-templates')).templates); }
  async function save(body: TemplateInput) {
    const selected = editing;
    const { event_type, ...patch } = body;
    await apiJson(selected ? `/api/task-templates/${selected.id}` : '/api/task-templates', { method: selected ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(selected ? { ...patch, version: selected.version } : { ...patch, event_type }) });
    setEditing(undefined); setNotice('テンプレートを保存しました');
    try { await refresh(); } catch { setError('保存しましたが一覧を更新できませんでした。最新の内容を取得してください。'); }
  }
  async function toggle(template: TaskTemplate) {
    if (!confirm(`「${template.title}」を${template.active ? '無効' : '有効'}にしますか？生成済みのタスクは変更されません。`)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await apiJson(`/api/task-templates/${template.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !template.active, version: template.version }) });
      await refresh(); setNotice('有効設定を変更しました');
    } catch (error) { setError(error instanceof Error ? error.message : '変更に失敗しました'); }
    finally { setBusy(false); }
  }
  async function reload() {
    if (editing !== undefined && !confirm('編集中の入力を破棄して、最新の内容を取得しますか？')) return;
    setBusy(true); setError('');
    try { await refresh(); setEditing(undefined); }
    catch (error) { setError(error instanceof Error ? error.message : '取得に失敗しました'); }
    finally { setBusy(false); }
  }
  const visible = templates.filter((template) => template.event_type === type);
  return <div className="space-y-5">
    <h1 className="text-2xl font-bold text-slate-800">タスクテンプレート</h1>
    <p className="text-sm text-slate-600">運営実績に合わせたタスクと期限の日数を、イベント種別ごとに登録できます。テンプレートからのタスク生成は現在停止しています。保存済みのテンプレートは保管・編集でき、既存のタスクには変更を反映しません。</p>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">{notice}</p>}
    <label className="block max-w-sm text-sm">イベント種別<select aria-label="イベント種別" disabled={editing !== undefined} value={type} onChange={(e) => setType(e.target.value as EventType)} className={fieldClass}>{Object.entries(EVENT_TYPE_LABELS).filter(([key])=>key!=='OTHER').map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <div className="flex flex-wrap gap-3"><button disabled={busy || loading || editing !== undefined} onClick={() => { setEditing(null); setNotice(''); }} className="rounded-lg bg-sky-800 px-4 py-2 text-white disabled:opacity-50">＋ テンプレートを追加</button><button disabled={busy} onClick={reload} className="rounded-lg border bg-white px-4 py-2">最新の内容を取得</button></div>
    {editing !== undefined && <TemplateEditor key={editing?.id ?? 'new'} initial={editing} type={type} onSave={save} onCancel={() => setEditing(undefined)} />}
    {loading && <p>読み込み中…</p>}
    {!loading && !visible.length && <p className="rounded-xl border bg-white p-6 text-slate-500">この種別のテンプレートは未登録です。過去の運営に合わせて追加してください。</p>}
    <div className="grid gap-4 sm:grid-cols-2">{visible.map((template) => <article key={template.id} className="min-w-0 rounded-xl border bg-white p-5 space-y-3">
      <p className="text-sm text-slate-500">{template.active ? '有効' : '無効'}{template.important ? '・重要' : ''}</p>
      <h2 className="break-words text-lg font-bold">{template.title}</h2>
      {template.description && <p className="whitespace-pre-wrap break-words text-sm">{template.description}</p>}
      <p>期限：{template.relative_days === 0 ? '基準日当日' : template.relative_days < 0 ? `基準日の${-template.relative_days}日前` : `基準日の${template.relative_days}日後`}</p>
      <div className="flex gap-4 text-sm"><button disabled={busy || editing !== undefined} onClick={() => setEditing(template)} className="text-sky-700 underline">編集</button><button disabled={busy || editing !== undefined} onClick={() => toggle(template)} className="text-sky-700 underline">{template.active ? '無効にする' : '有効にする'}</button></div>
    </article>)}</div>
  </div>;
}
