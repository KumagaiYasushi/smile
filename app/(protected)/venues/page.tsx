'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/client-api';
import { emptyVenue, parseVenue, VENUE_FIELD_LABELS } from '@/types/venue';
import type { Venue, VenueInput, VenueStatus, VenueHistory } from '@/types/venue';

const inputClass = 'mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const buttonClass = 'rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50';
const fee = (value: number | null) => value === null ? '未定' : `¥${value.toLocaleString()}`;

function VenueEditor({ initial, onSave, onCancel }: { initial: Venue | null; onSave: (input: VenueInput) => Promise<void>; onCancel: () => void }) {
  const [data, setData] = useState<VenueInput>(() => initial ? parseVenue({}, initial) : emptyVenue());
  const [capacity, setCapacity] = useState(String(initial?.capacity ?? ''));
  const [referenceFee, setReferenceFee] = useState(String(initial?.reference_fee ?? ''));
  const [saving, setSaving] = useState(false), [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try { await onSave(parseVenue({ ...data, capacity: capacity === '' ? null : Number(capacity), reference_fee: referenceFee === '' ? null : Number(referenceFee) })); }
    catch (error) { setError(error instanceof Error ? error.message : '保存できませんでした'); }
    finally { setSaving(false); }
  }
  return <form aria-label="会場の編集" onSubmit={submit} className="space-y-4 rounded-2xl border border-sky-200 bg-white p-5">
    <h2 className="font-bold">{initial ? '会場を編集' : '会場を登録'}</h2>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {(['name', 'room', 'contact_person', 'phone', 'email', 'website', 'fee_unit'] as const).map(key => <label key={key} className="block text-sm">{VENUE_FIELD_LABELS[key]}{key === 'name' ? '（必須）' : ''}
      <input required={key === 'name'} type={key === 'email' ? 'email' : key === 'website' ? 'url' : key === 'phone' ? 'tel' : 'text'}
        maxLength={key === 'email' ? 254 : key === 'website' ? 2000 : key === 'phone' || key === 'fee_unit' ? 100 : 200}
        value={data[key]} onChange={e => setData({ ...data, [key]: e.target.value })} className={inputClass} />
    </label>)}
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm">定員（人）<input type="number" min={0} step={1} max={Number.MAX_SAFE_INTEGER} value={capacity} onChange={e => setCapacity(e.target.value)} className={inputClass} /></label>
      <label className="block text-sm">参考料金（円）<input type="number" min={0} step={1} max={Number.MAX_SAFE_INTEGER} value={referenceFee} onChange={e => setReferenceFee(e.target.value)} className={inputClass} /></label>
    </div>
    <p className="text-xs text-slate-500">定員・参考料金の空欄は未定です。料金の単位・条件には「1時間」「半日」などを入力してください。</p>
    {(['address', 'access', 'equipment', 'booking_notes', 'notes'] as const).map(key => <label key={key} className="block text-sm">{VENUE_FIELD_LABELS[key]}
      <textarea aria-label={VENUE_FIELD_LABELS[key]} rows={key === 'notes' || key === 'booking_notes' ? 3 : 2} maxLength={2000} value={data[key]} onChange={e => setData({ ...data, [key]: e.target.value })} className={inputClass} />
    </label>)}
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={data.active} onChange={e => setData({ ...data, active: e.target.checked })} />利用候補として表示</label>
    <div className="flex flex-wrap gap-3">
      <button disabled={saving} className="rounded-lg bg-sky-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? '保存中…' : '保存する'}</button>
      <button type="button" disabled={saving} onClick={onCancel} className={buttonClass}>キャンセル</button>
    </div>
  </form>;
}

function History({ id }: { id: number }) {
  const [items, setItems] = useState<VenueHistory[] | null>(null), [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    apiJson(`/api/venues/${id}`, { signal: controller.signal }).then(result => setItems(result.history))
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [id]);
  return <div className="mt-4 border-t border-slate-200 pt-4 text-sm" aria-label="会場の変更履歴">
    <h3 className="font-bold">変更履歴（直近100件）</h3>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!items && !error && <p>読み込み中…</p>}
    <ol className="mt-3 space-y-3">{items?.map(item => <li key={item.id} className="rounded-lg bg-slate-50 p-3">
      <p>{new Date(item.occurred_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}（日本時間）・{item.action === 'created' ? '登録' : '更新'}・操作アカウント #{item.actor_id}</p>
      <p>変更項目：{item.changed_fields.map(key => VENUE_FIELD_LABELS[key]).join('、')}</p>
      <p>利用状態：{item.after.active ? '利用候補' : '利用停止'}・定員 {item.after.capacity ?? '未定'}・参考料金 {fee(item.after.reference_fee)}</p>
    </li>)}</ol>
  </div>;
}

export default function VenuesPage() {
  const [venues, setVenues] = useState<Venue[] | null>(null);
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  const [status, setStatus] = useState<VenueStatus>('ACTIVE');
  const [editor, setEditor] = useState<Venue | null | undefined>(undefined);
  const [history, setHistory] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const path = `/api/venues?query=${encodeURIComponent(query)}&status=${status}`;
  const load = useCallback(async () => { const result = await apiJson(path); setVenues(result.venues); }, [path]);
  useEffect(() => {
    const controller = new AbortController();
    apiJson(path, { signal: controller.signal }).then(result => setVenues(result.venues))
      .catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [path]);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : '処理に失敗しました'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <Link href="/" className="text-sm text-sky-800 underline">← イベント一覧に戻る</Link>
    <div><h1 className="text-2xl font-bold">会場台帳</h1><p className="mt-2 text-sm text-slate-600">会場・部屋ごとに住所、窓口、料金、設備、予約条件を登録します。イベント登録・編集画面で選択できます。</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    <div className="flex flex-wrap gap-2"><button disabled={busy || editor !== undefined} onClick={() => { setMessage(''); setEditor(null); }} className={buttonClass}>＋ 会場を登録</button>
      <button disabled={busy || editor !== undefined} onClick={() => action(load)} className={buttonClass}>最新情報を取得</button></div>
    {editor !== undefined && <VenueEditor key={editor?.id ?? 'new'} initial={editor} onCancel={() => setEditor(undefined)} onSave={async input => {
      setBusy(true);
      try {
        const result = await apiJson(editor ? `/api/venues/${editor.id}` : '/api/venues', { method: editor ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...input, ...(editor ? { version: editor.version } : {}) }) });
        setVenues(current => [...(current ?? []).filter(venue => venue.id !== result.venue.id), result.venue]);
        setEditor(undefined); setHistory(null); setMessage('保存しました'); setError('');
        try { await load(); } catch { setError('保存済みですが一覧を更新できませんでした。最新情報を取得してください'); }
      } finally { setBusy(false); }
    }} />}
    <form aria-label="会場検索" onSubmit={event => { event.preventDefault(); setError(''); const next = search.trim(); if (next === query) action(load); else setQuery(next); }} className="flex flex-wrap items-end gap-3">
      <label className="block min-w-0 flex-1 text-sm">会場を検索<input disabled={busy || editor !== undefined} maxLength={200} value={search} onChange={e => setSearch(e.target.value)} placeholder="会場名・部屋名・住所・窓口担当者" className={inputClass} /></label>
      <button disabled={busy || editor !== undefined} className={buttonClass}>検索</button>
      <label className="block text-sm">利用状態<select aria-label="利用状態" disabled={busy || editor !== undefined} value={status} onChange={e => { setStatus(e.target.value as VenueStatus); setError(''); }} className={inputClass}>
        <option value="ACTIVE">利用候補</option><option value="INACTIVE">利用停止</option><option value="ALL">すべて</option>
      </select></label>
    </form>
    <p className="text-xs text-slate-500">利用停止の会場は新しいイベントの選択肢から外します。既存イベントの会場名・住所・会場費は台帳の変更後も保持します。</p>
    {!venues && !error && <p>読み込み中…</p>}
    {venues && <p className="text-sm text-slate-500">該当 {venues.length}件</p>}
    <div className="space-y-4">{venues?.map(venue => <article key={venue.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 className="break-words font-bold">{venue.name}</h2>
        <p className="mt-1 break-words text-sm text-slate-500">{venue.room || '部屋名未設定'}・{venue.active ? '利用候補' : '利用停止'}</p></div>
        <div className="flex flex-wrap gap-2"><button disabled={busy || editor !== undefined} onClick={() => setEditor(venue)} className={buttonClass}>編集</button>
          <button disabled={busy || editor !== undefined} onClick={() => action(async () => {
            await apiJson(`/api/venues/${venue.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: venue.version, active: !venue.active }) });
            setHistory(null); await load(); setMessage(venue.active ? '利用停止にしました' : '利用候補に戻しました');
          })} className={buttonClass}>{venue.active ? '利用停止にする' : '利用候補に戻す'}</button>
          <button onClick={() => setHistory(history === venue.id ? null : venue.id)} className={buttonClass}>履歴</button></div>
      </div>
      <dl className="mt-4 space-y-2 text-sm">{([
        ['住所', venue.address || '未設定'], ['アクセス', venue.access || '未設定'], ['窓口担当者', venue.contact_person || '未設定'],
        ['電話番号', venue.phone || '未設定'], ['メールアドレス', venue.email || '未設定'], ['公式サイト・予約ページ', venue.website || '未設定'],
        ['定員', venue.capacity === null ? '未定' : `${venue.capacity.toLocaleString()}人`], ['参考料金', `${fee(venue.reference_fee)}${venue.fee_unit ? `／${venue.fee_unit}` : ''}`],
        ['設備・備品', venue.equipment || '未設定'], ['予約方法・キャンセル条件', venue.booking_notes || '未設定'], ['備考', venue.notes || 'なし'],
      ]).map(([label, value]) => <div key={label} className="flex flex-wrap gap-x-4 gap-y-1"><dt className="text-slate-500">{label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{value}</dd></div>)}</dl>
      {history === venue.id && <History key={`${venue.id}:${venue.version}`} id={venue.id} />}
    </article>)}</div>
    {venues?.length === 0 && <p className="py-6 text-center text-slate-500">条件に合う会場はありません。新しく登録するか、検索条件を変更してください。</p>}
  </div>;
}
