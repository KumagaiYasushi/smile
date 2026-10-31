'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { AdmissionSummary, Registration } from '@/types/registration';
import { ADMISSION_LABELS } from '@/types/registration';
const button = 'rounded-lg bg-sky-800 px-4 py-2 text-white font-bold disabled:opacity-50';

export function CapacityEditor({ admission }: { admission: AdmissionSummary }) {
  const router = useRouter(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setError(''); setBusy(true);
    try {
      const response = await fetch(`/api/events/${admission.event_id}/admission`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capacity: Number(data.get('capacity')), event_version: admission.event_version }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : '保存できませんでした'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-3">
    <label className="block">定員（人）<input name="capacity" type="number" min={Math.max(1, admission.confirmed_count)} max={100000} defaultValue={admission.capacity ?? ''} required className="mt-1 w-full rounded-lg border p-3" /></label>
    <label className="block text-sm"><input type="checkbox" required /> 確定人数と変更後の定員を確認しました。</label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button className={button} disabled={busy}>定員を保存</button>
  </form>;
}

export function ConfirmRegistration({ registration, admission }: { registration: Registration; admission: AdmissionSummary }) {
  const router = useRouter(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  if (registration.application_status === 'CONFIRMED') return <p className="font-bold text-green-800">受付確定済み（出欠・入金とは別）</p>;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch(`/api/registrations/${registration.id}/confirm`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewed: true, event_version: admission.event_version }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : '確定できませんでした'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-3 border-t pt-3">
    <label className="block text-sm"><input type="checkbox" required disabled={admission.state !== 'OPEN'} /> 申込情報・照合結果を確認し、この申込に1名分の席を確保します。</label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <button className={button} disabled={busy || admission.state !== 'OPEN'}>受付を確定</button>
    {admission.state !== 'OPEN' && <p className="text-sm text-amber-800">{ADMISSION_LABELS[admission.state]}のため確定できません。</p>}
    <button type="button" className="ml-3 text-sm underline text-sky-800" onClick={() => router.refresh()}>最新の残席を確認</button>
  </form>;
}
