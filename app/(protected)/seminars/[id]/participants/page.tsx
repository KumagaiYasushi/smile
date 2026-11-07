'use client';

import { useEffect, useState, useRef, use } from 'react';
import Link from 'next/link';
import ParticipantMailPanel from '@/components/ParticipantMailPanel';
import { apiJson } from '@/lib/client-api';
import { Seminar } from '@/types/seminar';
import { Participant, ParticipantFields, ParticipantRole, PaymentMethod, PaymentStatus, ROLE_LABELS, PAYMENT_LABELS, PAYMENT_METHOD_LABELS, canIssueReceipt } from '@/types/participant';

type Props = { params: Promise<{ id: string }> };

const ROLES: ParticipantRole[] = ['dental_hygienist', 'dentist', 'other'];

function getFeeForRole(seminar: Seminar, role: ParticipantRole): number {
  if (role === 'dental_hygienist') return seminar.fee_dental_hygienist;
  if (role === 'dentist') return seminar.fee_dentist;
  return seminar.fee_other;
}

export default function ParticipantsPage({ params }: Props) {
  const { id } = use(params);
  const [seminar, setSeminar] = useState<Seminar | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [editTarget, setEditTarget] = useState<Participant | null>(null);

  const [form, setForm] = useState<ParticipantFields>({
    name: '', receipt_name:'', role: 'dental_hygienist' as ParticipantRole,
    email: '', phone: '', payment_status: 'unpaid', payment_method: 'bank_transfer', paid_amount: null,
    attended: false, receipt_number: '', notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (showForm && !dialogRef.current?.open) dialogRef.current?.showModal(); }, [showForm]);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiJson(`/api/seminars/${id}`, { signal: controller.signal }),
      apiJson(`/api/seminars/${id}/participants`, { signal: controller.signal }),
    ]).then(([s, p]) => {
      if (controller.signal.aborted) return;
      setSeminar(s); setParticipants(p); setLoading(false);
    }).catch((error) => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [id]);

  const openAdd = () => {
    setError('');
    setEditTarget(null);
    setForm({ name: '', receipt_name:'', role: 'dental_hygienist', email: '', phone: '', payment_status: 'unpaid', payment_method: 'bank_transfer', paid_amount: null, attended: false, receipt_number: '', notes: '' });
    setShowForm(true);
  };

  const openEdit = (p: Participant) => {
    setError('');
    setEditTarget(p);
    setForm({ name: p.name, receipt_name:p.receipt_name??'', role: p.role, email: p.email, phone: p.phone, payment_status: p.payment_status, payment_method: p.payment_method, paid_amount: p.paid_amount, attended: p.attended, receipt_number: p.receipt_number, notes: p.notes });
    setShowForm(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      if (editTarget) {
        const updated = await apiJson(`/api/seminars/${id}/participants/${editTarget.id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
        });
        setParticipants((prev) => prev.map((p) => p.id === updated.id ? updated : p));
      } else {
        const created = await apiJson(`/api/seminars/${id}/participants`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
        });
        setParticipants((prev) => [...prev, created]);
      }
      setShowForm(false);
    } catch (error) { setError(error instanceof Error ? error.message : '参加者を保存できませんでした'); }
    finally { setSaving(false); }
  };

  const togglePayment = async (p: Participant) => {
    if (!p.payment_confirmed_at || p.payment_status === 'unpaid') {
      openEdit(p);
      setForm(current => ({ ...current, payment_status: 'paid', paid_amount: p.paid_amount ?? getFeeForRole(seminar!, p.role) }));
      return;
    }
    if (!confirm(`「${p.name}」の入金確認を取り消しますか？`)) return;
    setBusy(true); setError('');
    try {
      const updated = await apiJson(`/api/seminars/${id}/participants/${p.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_status: 'unpaid' }),
      });
      setParticipants((prev) => prev.map((x) => x.id === updated.id ? updated : x));
    } catch (error) { setError(error instanceof Error ? error.message : '入金状況を更新できませんでした'); }
    finally { setBusy(false); }
  };

  const issueReceipt = async (p: Participant) => {
    if (!confirm(`「${p.name}」の銀行振込 ¥${p.paid_amount?.toLocaleString()} の領収書を発行しますか？発行後の入金情報・領収書番号は変更できません。`)) return;
    setBusy(true); setError('');
    try {
      const { receipt } = await apiJson(`/api/seminars/${id}/participants/${p.id}/receipt`, { method: 'POST' });
      setParticipants(prev => prev.map(x => x.id === p.id ? { ...x, issued_receipt_id: receipt.id, receipt_issued_at: receipt.issued_at, receipt_number: receipt.receipt_number } : x));
    } catch (error) { setError(error instanceof Error ? error.message : '領収書を発行できませんでした'); }
    finally { setBusy(false); }
  };
  const receiptAction = (p: Participant) => p.issued_receipt_id
    ? <Link href={`/seminars/${id}/participants/${p.id}/receipt`} target="_blank" className="py-2 text-sky-700 underline">領収書</Link>
    : canIssueReceipt(p) ? <button disabled={busy} onClick={() => issueReceipt(p)} className="py-2 text-sky-700 underline">領収書を発行</button>
      : <span className="py-2 text-xs text-slate-500">銀行振込の入金確認後に発行</span>;
  const paymentLabel = (p: Participant) => p.payment_status === 'paid' && !p.payment_confirmed_at ? '入金確認待ち' : PAYMENT_LABELS[p.payment_status];

  const toggleAttended = async (p: Participant) => {
    setBusy(true); setError('');
    try {
      const updated = await apiJson(`/api/seminars/${id}/participants/${p.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attended: !p.attended }),
      });
      setParticipants((prev) => prev.map((x) => x.id === updated.id ? updated : x));
    } catch (error) { setError(error instanceof Error ? error.message : '出席状況を更新できませんでした'); }
    finally { setBusy(false); }
  };

  const handleDelete = async (p: Participant) => {
    if (!confirm(`「${p.name}」を削除しますか？`)) return;
    setBusy(true); setError('');
    try {
      await apiJson(`/api/seminars/${id}/participants/${p.id}`, { method: 'DELETE' });
      setParticipants((prev) => prev.filter((x) => x.id !== p.id));
    } catch (error) { setError(error instanceof Error ? error.message : '参加者を削除できませんでした'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">読み込み中...</div>;
  if (!seminar) return <div role="alert" className="text-center py-16 text-slate-500">{error || 'セミナーが見つかりません'}</div>;

  const paidCount = participants.filter((p) => p.payment_status === 'paid').length;
  const totalRevenue = participants
    .filter((p) => p.payment_status === 'paid')
    .reduce((sum, p) => sum + (p.paid_amount ?? 0), 0);

  const byRole = ROLES.map((role) => ({
    role, label: ROLE_LABELS[role],
    count: participants.filter((p) => p.role === role).length,
  }));

  return (
    <div className="space-y-6">
      {error && !showForm && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
      {/* ヘッダー */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm text-slate-500 mb-1">
            <Link href={`/seminars/${id}`} className="break-words hover:text-sky-600">← {seminar.name}</Link>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">参加者名簿</h1>
        </div>
        <button
          disabled={busy} onClick={openAdd}
          className="bg-sky-700 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-sky-600 transition-colors flex-shrink-0"
        >
          ＋ 参加者を追加
        </button>
      </div>

      {/* サマリー */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="参加者総数" value={`${participants.length}名`} />
        <StatCard label="入金済" value={`${paidCount}名`} accent="green" />
        <StatCard label="未入金" value={`${participants.length - paidCount}名`} accent={participants.length - paidCount > 0 ? 'red' : 'slate'} />
        <StatCard label="入金合計" value={`¥${totalRevenue.toLocaleString()}`} accent="sky" />
      </div>

      <p className="text-sm text-slate-600">未入金ボタンから実際の入金額を確認して保存します。自動メールを有効にした銀行振込の参加者には、保存後に領収書PDFを自動送信します。未設定の場合は「領収書を発行」を選べます。入金合計は確認済み金額の合計です。</p>
      <ParticipantMailPanel key={seminar.id} event={seminar} revision={JSON.stringify(participants.map(p=>[p.id,p.name,p.role,p.payment_status,p.paid_amount,p.receipt_name,p.email,p.receipt_issued_at]))}/>
      {/* 職種別内訳 */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4">
        <h2 className="text-sm font-bold text-slate-700 mb-3">職種別内訳</h2>
        <div className="flex gap-6">
          {byRole.map(({ role, label, count }) => (
            <div key={role} className="text-center">
              <div className="text-lg font-bold text-slate-800">{count}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 一覧テーブル */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {participants.length === 0 ? (
          <div className="p-12 text-center text-slate-400">参加者がまだいません</div>
        ) : (
          <>
          <div className="divide-y divide-slate-100 md:hidden" aria-label="参加者カード一覧">
            {participants.map((p) => <article key={p.id} className="space-y-3 p-4">
              <div><h3 className="break-words font-bold text-slate-800">{p.name}</h3><p className="text-sm text-slate-500">{ROLE_LABELS[p.role]}</p></div>
              <div className="space-y-1 break-all text-sm text-slate-600">{p.email && <p>{p.email}</p>}{p.phone && <p>{p.phone}</p>}<p>参加費：¥{getFeeForRole(seminar, p.role).toLocaleString()}</p><p>支払方法：{p.payment_method ? PAYMENT_METHOD_LABELS[p.payment_method] : '未設定'}</p><p>入金額：{p.paid_amount === null ? '未確認' : `¥${p.paid_amount.toLocaleString()}`}</p><p>領収書宛名：{p.receipt_name||p.name}</p><p>領収書No.：{p.receipt_number || '—'}</p></div>
              <div className="flex flex-wrap gap-3">
                <button disabled={busy || !!p.issued_receipt_id} onClick={() => togglePayment(p)} className={`rounded-full px-3 py-2 text-sm font-bold ${p.payment_status === 'paid' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-700'}`}>{paymentLabel(p)}</button>
                <button disabled={busy} onClick={() => toggleAttended(p)} className={`rounded-full px-3 py-2 text-sm font-bold ${p.attended ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600'}`}>{p.attended ? '出席' : '未確認'}</button>
              </div>
              <div className="flex flex-wrap gap-5 text-sm">
                {receiptAction(p)}
                <button disabled={busy} onClick={() => openEdit(p)} className="py-2 text-sky-700 underline">編集</button>
                <button disabled={busy} onClick={() => handleDelete(p)} className="py-2 text-red-700 underline">削除</button>
              </div>
            </article>)}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">氏名</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">職種</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">連絡先</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">参加費</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">入金</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">出席</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">領収書No.</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {participants.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-800">{p.name}</td>
                    <td className="px-4 py-3 text-slate-600">{ROLE_LABELS[p.role]}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {p.email && <div>{p.email}</div>}
                      {p.phone && <div>{p.phone}</div>}
                    </td>
                    <td className="px-4 py-3 text-slate-700">
                      ¥{getFeeForRole(seminar, p.role).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        disabled={busy || !!p.issued_receipt_id} onClick={() => togglePayment(p)}
                        className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors ${
                          p.payment_status === 'paid'
                            ? 'bg-green-100 text-green-700 hover:bg-green-200'
                            : 'bg-red-100 text-red-600 hover:bg-red-200'
                        }`}
                      >
                        {paymentLabel(p)}
                      </button>
                      <p className="mt-1 text-xs text-slate-500">{p.payment_method ? PAYMENT_METHOD_LABELS[p.payment_method] : '支払方法未設定'}<br />{p.paid_amount === null ? '入金額未確認' : `¥${p.paid_amount.toLocaleString()}`}</p>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        disabled={busy} onClick={() => toggleAttended(p)}
                        className={`px-2.5 py-1 rounded-full text-xs font-bold transition-colors ${
                          p.attended
                            ? 'bg-sky-100 text-sky-700 hover:bg-sky-200'
                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                        }`}
                      >
                        {p.attended ? '出席' : '未確認'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{p.receipt_number || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2 justify-end">
                        {receiptAction(p)}
                        <button
                          disabled={busy} onClick={() => openEdit(p)}
                          className="text-xs text-slate-500 hover:text-slate-700"
                        >
                          編集
                        </button>
                        <button
                          disabled={busy} onClick={() => handleDelete(p)}
                          className="text-xs text-red-400 hover:text-red-600"
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {/* 登録・編集モーダル */}
      {showForm && (
        <dialog ref={dialogRef} aria-labelledby="participant-form-title" onClose={() => { setShowForm(false); setError(''); }} onCancel={(event) => { if (saving) event.preventDefault(); }} className="m-auto max-h-[calc(100dvh_-_2rem)] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-2xl border-0 p-0 backdrop:bg-black/40">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-xl">
            <div className="p-6 border-b border-slate-200">
              <h2 id="participant-form-title" className="font-bold text-slate-800">{editTarget ? '参加者を編集' : '参加者を追加'}</h2>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
              <div>
                <label htmlFor="participant-name" className="block text-sm font-medium text-slate-700 mb-1">氏名 <span className="text-red-500">*</span></label>
                <input
                  type="text"
                  id="participant-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  placeholder="例：山田 花子"
                  className={input}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="participant-role" className="block text-sm font-medium text-slate-700 mb-1">職種</label>
                  <select
                    id="participant-role"
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value as ParticipantRole })}
                    className={input}
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="participant-payment" className="block text-sm font-medium text-slate-700 mb-1">入金状況</label>
                  <select
                    id="participant-payment"
                    disabled={!!editTarget?.issued_receipt_id}
                    value={form.payment_status}
                    onChange={(e) => setForm({ ...form, payment_status: e.target.value as PaymentStatus, paid_amount: e.target.value === 'paid' ? form.paid_amount ?? getFeeForRole(seminar, form.role) : null })}
                    className={input}
                  >
                    <option value="unpaid">未入金</option>
                    <option value="paid">入金済</option>
                  </select>
                </div>
              </div>
              <label className="block text-sm font-medium text-slate-700">支払方法
                <select aria-label="支払方法" disabled={!!editTarget?.issued_receipt_id} value={form.payment_method ?? ''} onChange={e => setForm({ ...form, payment_method: e.target.value ? e.target.value as PaymentMethod : null })} className={input}>
                  <option value="">未設定</option>{Object.entries(PAYMENT_METHOD_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              {form.payment_status === 'paid' && <label className="block text-sm font-medium text-slate-700">確認した入金額（円）
                <input aria-label="確認した入金額（円）" type="number" min="0" step="1" required disabled={!!editTarget?.issued_receipt_id} value={form.paid_amount ?? ''} onChange={e => setForm({ ...form, paid_amount: e.target.value === '' ? null : Number(e.target.value) })} className={input} />
                <span className="mt-1 block text-xs text-slate-500">実際の入金額を確認して保存してください。銀行振込は保存後に領収書を発行できます。</span>
              </label>}
              <label className="block text-sm font-medium">領収書宛名<input aria-label="領収書宛名" maxLength={200} readOnly={!!editTarget?.issued_receipt_id} value={form.receipt_name} onChange={e=>setForm({...form,receipt_name:e.target.value})} className="mt-1 block w-full rounded-lg border p-2"/><span className="text-xs text-slate-600">未入力の場合は参加者の氏名を使用します。</span></label>
              {editTarget?.issued_receipt_id && <p className="text-sm text-slate-500">領収書発行済みの入金情報・領収書番号は変更できません。領収書には発行時の情報を保持します。</p>}
              <div>
                <label htmlFor="participant-email" className="block text-sm font-medium text-slate-700 mb-1">メールアドレス</label>
                <input id="participant-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="example@example.com" className={input} />
              </div>
              <div>
                <label htmlFor="participant-phone" className="block text-sm font-medium text-slate-700 mb-1">電話番号</label>
                <input id="participant-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="090-0000-0000" className={input} />
              </div>
              <div>
                <label htmlFor="participant-receipt" className="block text-sm font-medium text-slate-700 mb-1">領収書No.</label>
                <input id="participant-receipt" type="text" disabled={!!editTarget?.issued_receipt_id} value={form.receipt_number} onChange={(e) => setForm({ ...form, receipt_number: e.target.value })} placeholder="例：2024-001" className={input} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="attended"
                  checked={form.attended}
                  onChange={(e) => setForm({ ...form, attended: e.target.checked })}
                  className="w-4 h-4 rounded"
                />
                <label htmlFor="attended" className="text-sm text-slate-700">出席済み</label>
              </div>
              <div>
                <label htmlFor="participant-notes" className="block text-sm font-medium text-slate-700 mb-1">メモ</label>
                <textarea id="participant-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className={input} />
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <button type="button" disabled={saving} onClick={() => setShowForm(false)} className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm hover:bg-slate-50">
                  キャンセル
                </button>
                <button type="submit" disabled={saving} className="px-5 py-2 bg-sky-700 text-white rounded-lg text-sm font-bold hover:bg-sky-600 disabled:opacity-50">
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </dialog>
      )}
    </div>
  );
}

function StatCard({ label, value, accent = 'slate' }: { label: string; value: string; accent?: string }) {
  const colors: Record<string, string> = {
    slate: 'text-slate-800',
    green: 'text-green-700',
    red: 'text-red-600',
    sky: 'text-sky-700',
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-xl font-bold ${colors[accent] ?? colors.slate}`}>{value}</div>
    </div>
  );
}

const input = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent';
