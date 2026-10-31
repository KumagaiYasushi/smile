'use client';
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Contact, ParticipantMaster, ParticipantSearch, Registration } from '@/types/registration';
import { MATCH_LABELS } from '@/types/registration';

const inputClass = 'mt-1 w-full rounded-lg border border-slate-300 bg-white p-3';
const buttonClass = 'rounded-lg bg-sky-800 px-5 py-3 text-white font-bold disabled:opacity-50';
function ContactFields({ contact }: { contact?: Contact }) {
  return <div className="grid gap-4 sm:grid-cols-2">
    <label>氏名（不明なら空欄）<input name="name" defaultValue={contact?.name} maxLength={500} autoComplete="off" className={inputClass} /></label>
    <label>携帯電話番号（不明なら空欄）<input name="mobile" type="tel" defaultValue={contact?.mobile} maxLength={64} autoComplete="off" className={inputClass} /></label>
    <label>メールアドレス<input name="email" type="email" defaultValue={contact?.email} maxLength={254} autoComplete="off" className={inputClass} /></label>
    <label>勤務先<input name="workplace" defaultValue={contact?.workplace} maxLength={500} autoComplete="off" className={inputClass} /></label>
  </div>;
}
const contactFrom = (form: FormData) => Object.fromEntries(['name', 'mobile', 'email', 'workplace'].map(key => [key, String(form.get(key) ?? '')]));
async function send(path: string, body: object, method: string) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '保存できませんでした');
  return result;
}

export function ParticipantSearchPanel({ initial }: { initial: ParticipantSearch }) {
  const [result, setResult] = useState(initial), [query, setQuery] = useState(''), [submittedQuery, setSubmittedQuery] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function search(value: string, page: number) {
    setBusy(true); setError('');
    try { setResult(await send('/api/participants/search', { query: value, page }, 'POST')); setSubmittedQuery(value); }
    catch (error) { setError(error instanceof Error ? error.message : '検索できませんでした'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-5">
    <form onSubmit={e => { e.preventDefault(); void search(query, 1); }} className="flex flex-wrap gap-3"><label className="flex-1">氏名・携帯・メール・勤務先<input value={query} onChange={e => setQuery(e.target.value)} maxLength={100} autoComplete="off" className={inputClass} /></label><button disabled={busy} className={`${buttonClass} self-end`}>検索</button></form>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    <p role="status">{result.total}人 · {result.page}ページ</p>
    <div className="grid gap-4 md:grid-cols-2">{result.items.map(row => <Link key={row.id} href={`/participants/${row.id}`} className="rounded-xl border bg-white p-5 hover:border-sky-600"><h2 className="font-bold">{row.current_name.trim() || '氏名未登録'}</h2><p className="text-sm mt-2">{row.current_mobile || '携帯未登録'}</p><p className="text-sm break-all mt-2">{row.current_email || 'メール未登録'}</p><p className="text-sm mt-2">{row.current_workplace || '勤務先未登録'}</p><p className="text-sm text-slate-600 mt-3">申込記録 {row.registration_count}件（出席・受講回数ではありません）</p></Link>)}</div>
    {!result.items.length && <p>該当する参加者はいません。</p>}
    <nav aria-label="検索結果のページ" className="flex gap-6">{result.page > 1 && <button disabled={busy} onClick={() => void search(submittedQuery, result.page - 1)} className="underline">前へ</button>}{result.page * result.page_size < result.total && <button disabled={busy} onClick={() => void search(submittedQuery, result.page + 1)} className="underline">次へ</button>}</nav>
  </div>;
}

export function RegistrationForm({ eventId }: { eventId: number }) {
  const router = useRouter();
  const [requestKey, setRequestKey] = useState<string | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [result, setResult] = useState<Registration | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, snapshot = contactFrom(new FormData(form));
    const key = requestKey ?? crypto.randomUUID(); setRequestKey(key); setBusy(true); setError(''); setResult(null);
    try {
      const registered = await send(`/api/events/${eventId}/registrations`, { request_key: key, snapshot }, 'POST');
      setResult(registered); setRequestKey(null); form.reset(); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : '通信に失敗しました。同じ内容で再試行できます。'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-5 rounded-xl border bg-white p-5">
    <h2 className="text-lg font-bold">申込情報を記録</h2>
    <p className="text-sm text-slate-600">氏名と携帯の両方が完全に一致し、候補が1人なら紐付けます。表記・空白・番号の区切りを自動変換しません。実参加者の情報は入力しないでください。</p>
    <ContactFields />
    <label className="block text-sm"><input type="checkbox" required /> 架空データであることを確認しました。受付確定・入金・出席の記録ではありません。</label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {result && <p role="status" className="rounded-lg bg-sky-50 p-3 text-sm">申込情報を記録しました（受付確認待ち）。{MATCH_LABELS[result.match_status]}。<Link className="text-sky-800 underline" href={`/participants/${result.participant_id}`}>参加者の履歴を確認</Link></p>}
    <button disabled={busy} className={buttonClass}>{busy ? '記録中…' : '申込情報を記録'}</button>
  </form>;
}

export function ParticipantEditor({ participant }: { participant: ParticipantMaster }) {
  const router = useRouter(); const [busy, setBusy] = useState(false), [error, setError] = useState(''), [saved, setSaved] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const contact = contactFrom(new FormData(event.currentTarget));
    setBusy(true); setError(''); setSaved(false);
    try {
      await send(`/api/participants/${participant.id}`, { version: participant.version, contact }, 'PATCH');
      setSaved(true); router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : '通信に失敗しました'); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="rounded-xl border bg-white p-5 space-y-5">
    <h2 className="text-lg font-bold">現在の代表情報を編集</h2>
    <p className="text-sm text-slate-600">保存しても過去の申込情報は変わりません。変更前の連絡先は履歴に残ります。同じ氏名・携帯の別参加者がいても統合は行いません。</p>
    <ContactFields contact={{ name: participant.current_name, mobile: participant.current_mobile, email: participant.current_email, workplace: participant.current_workplace }} />
    <label className="block text-sm"><input type="checkbox" required /> 内容を確認し、現在の代表情報として保存します。</label>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}{saved && <p role="status">保存しました。</p>}
    <div className="flex flex-wrap gap-4"><button disabled={busy} className={buttonClass}>代表情報を保存</button><button type="button" className="text-sky-800 underline" onClick={() => router.refresh()}>最新情報を再読み込み</button></div>
  </form>;
}
