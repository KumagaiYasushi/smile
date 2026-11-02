'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/client-api';
import { venueLocation } from '@/types/venue';
import type { Venue } from '@/types/venue';

export default function VenuePicker({ value, onSelect, onReferenceFee }: {
  value: number | null; onSelect: (id: number | null, location?: string) => void; onReferenceFee: (fee: number) => void;
}) {
  const [venues, setVenues] = useState<Venue[]>([]), [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    apiJson('/api/venues?status=ALL', { signal: controller.signal }).then(result => { setVenues(result.venues); setLoading(false); })
      .catch(error => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, []);
  async function reload() {
    setLoading(true); setError('');
    try { const result = await apiJson('/api/venues?status=ALL'); setVenues(result.venues); }
    catch (error) { setError(error instanceof Error ? error.message : '台帳を取得できませんでした'); }
    finally { setLoading(false); }
  }
  const selected = venues.find(venue => venue.id === value);
  return <div className="space-y-3 rounded-xl border border-sky-100 bg-sky-50 p-4 text-sm">
    <label className="block font-medium">会場台帳から選択
      <select aria-label="会場台帳から選択" disabled={loading} value={value ?? ''} onChange={event => {
        const id = event.target.value ? Number(event.target.value) : null;
        const venue = venues.find(item => item.id === id);
        onSelect(id, venue ? venueLocation(venue) : undefined);
      }} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2">
        <option value="">台帳との紐付けなし（直接入力）</option>
        {venues.filter(venue => venue.active || venue.id === value).map(venue => <option key={venue.id} value={venue.id}>{venue.name}{venue.room ? ` / ${venue.room}` : ''}{venue.active ? '' : '（利用停止）'}</option>)}
        {value && !selected && <option value={value}>登録済みの会場 #{value}</option>}
      </select>
    </label>
    <p className="text-slate-600">選択すると会場名・部屋名・住所を転記します。実際の会場費は確認して入力してください。</p>
    {loading && <p>台帳を読み込み中…</p>}
    {error && <p role="alert" className="text-red-700">会場台帳を取得できませんでした。直接入力して保存できます。</p>}
    {selected && <>
      <p className="whitespace-pre-wrap break-words">{selected.address || '住所未設定'}</p>
      <p>定員：{selected.capacity === null ? '未定' : `${selected.capacity.toLocaleString()}人`}・参考料金：{selected.reference_fee === null ? '未定' : `¥${selected.reference_fee.toLocaleString()}`}{selected.fee_unit ? `／${selected.fee_unit}` : ''}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!selected.active || loading} onClick={() => onSelect(selected.id, venueLocation(selected))} className="rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:opacity-50">会場情報を再転記</button>
        <button type="button" disabled={!selected.active || selected.reference_fee === null || loading} onClick={() => { if (selected.reference_fee !== null) onReferenceFee(selected.reference_fee); }} className="rounded-lg border border-slate-300 bg-white px-3 py-2 disabled:opacity-50">参考料金を会場費に入力</button>
      </div>
    </>}
    <div className="flex flex-wrap gap-3"><Link href="/venues" target="_blank" rel="noopener noreferrer" className="text-sky-800 underline">会場台帳を管理（別タブ）</Link>
      <button type="button" disabled={loading} onClick={reload} className="text-sky-800 underline disabled:opacity-50">台帳を再取得</button></div>
  </div>;
}
