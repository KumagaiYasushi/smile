'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/client-api';
import type { GenerationPreview } from '@/types/task-template';

export default function TemplateGenerationPanel({ seminarId, dates, disabled, onApplied }: { seminarId: string; dates: string[]; disabled: boolean; onApplied: () => Promise<void> }) {
  const choices = [...new Set(dates)];
  const [date, setDate] = useState(choices.length === 1 ? choices[0] : '');
  const [preview, setPreview] = useState<GenerationPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function showPreview() {
    setBusy(true); setError(''); setNotice(''); setPreview(null);
    try { setPreview((await apiJson(`/api/seminars/${seminarId}/tasks/template-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(date ? { base_date: date } : {}) })).preview); }
    catch (error) { setError(error instanceof Error ? error.message : '取得に失敗しました'); }
    finally { setBusy(false); }
  }
  async function apply() {
    if (!preview || !confirm(`表示中の${preview.items.length}件のタスクを追加しますか？`)) return;
    setBusy(true); setError('');
    try {
      const result = await apiJson(`/api/seminars/${seminarId}/tasks/apply-templates`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(preview.base_date ? { base_date: preview.base_date } : {}), preview_token: preview.preview_token }) });
      setPreview(null); setNotice(result.replayed ? '前回の追加は完了しています。重複するタスクは追加していません。' : `${result.created_count}件のタスクを追加しました`);
      try { await onApplied(); } catch { setError('追加しましたが一覧を更新できませんでした。最新の内容を取得してください。'); }
    } catch (error) { setError(error instanceof Error ? error.message : '追加に失敗しました'); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-sky-100 bg-sky-50 p-4 space-y-3 text-sm">
    <h2 className="font-bold">テンプレートからタスクを追加</h2>
    <p>この種別で未適用のテンプレートを追加します。既存タスクの期限・状態・担当者は保持されます。</p>
    <Link href="/task-templates" className="inline-block text-sky-800 underline">タスクテンプレートを管理</Link>
    {choices.length > 0 && <label className="block max-w-sm">期限の基準日<select aria-label="期限の基準日" disabled={busy || disabled} value={date} onChange={(e) => { setDate(e.target.value); setPreview(null); }} className="mt-1 block w-full rounded-lg border bg-white p-2"><option value="">開催日から選択</option>{choices.map((date) => <option key={date} value={date}>{date}</option>)}</select></label>}
    {choices.length === 0 && <p>イベントの開催日を設定してから期限を計算できます。</p>}
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {notice && <p role="status" className="text-green-800">{notice}</p>}
    <button disabled={busy || disabled} onClick={showPreview} className="rounded-lg border border-sky-300 bg-white px-4 py-2 disabled:opacity-50">生成予定をプレビュー</button>
    {preview && <div className="space-y-3">
      <p>追加予定 {preview.items.length}件・適用済み {preview.skipped_count}件</p>
      <ul className="space-y-2">{preview.items.map((item) => <li key={item.id} className="rounded-lg bg-white p-3 break-words"><span className="font-medium">{item.title}</span>{item.important && '（重要）'}<br />期限：{item.due_date}</li>)}</ul>
      {!preview.items.length && <p>追加できるテンプレートはありません。</p>}
      {!!preview.items.length && <button disabled={busy || disabled} onClick={apply} className="rounded-lg bg-sky-800 px-4 py-2 font-bold text-white disabled:opacity-50">確認して追加する</button>}
    </div>}
  </section>;
}
