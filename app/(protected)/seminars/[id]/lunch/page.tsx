'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/client-api';
import { parseLunch, lunchCost, summarizeLunch, LUNCH_TARGET_LABELS, LUNCH_STATUS_LABELS,defaultLunch,lunchTargets,lunchTargetLabel,lunchQuantities } from '@/types/lunch';
import type { LunchPlan, LunchInput, LunchData, LunchTarget, LunchCounts } from '@/types/lunch';

import LunchOrderFields from '@/components/LunchOrderFields';
const inputClass = 'mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const buttonClass = 'rounded-lg border border-slate-300 px-4 py-2 text-sm disabled:opacity-50';
const yen = (value: number | null) => value === null ? '未定' : `¥${value.toLocaleString()}`;
const day = (value: string | null) => value ?? '日程未定';

function LunchEditor({ initial, dates, onSave, onCancel, defaults }: {
  initial: LunchPlan | null; dates: string[]; onSave: (data: LunchInput) => Promise<void>; onCancel: () => void; defaults:Record<string,LunchCounts>;
}) {
  const zero:LunchCounts={LECTURER:0,EXTERNAL_LECTURER:0,SUPPORT:0,PARTICIPANT:0,OTHER:0};
  const getCounts=(date:string|null)=>defaults[date??'']??zero;
  const initialDate=dates.length===1?dates[0]:null;
  const [data,setData]=useState<LunchInput>(()=>initial??defaultLunch(getCounts(initialDate),initialDate));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  function submission() {
    const {date,target,targets,quantities,target_details,quantity,unit_price,additional_cost,shop_name,shop_contact,menu,notes,status}=data;
    return parseLunch({date,target,...(targets?{targets}:{}),...(quantities?{quantities}:{}),target_details,quantity,unit_price,additional_cost,shop_name,shop_contact,menu,notes,status});
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try { await onSave(submission()); }
    catch (error) { setError(error instanceof Error ? error.message : '保存できませんでした'); }
    finally { setSaving(false); }
  }
  return <form aria-label="昼食の手配編集" onSubmit={submit} className="space-y-4 rounded-2xl border border-sky-200 bg-white p-5">
    <h2 className="font-bold">{initial ? '昼食の手配を編集' : '昼食の手配を追加'}</h2>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <LunchOrderFields data={data} dates={dates} isNew={!initial} onChange={setData} getCounts={getCounts}/>
    <div className="flex flex-wrap gap-3">
      <button disabled={saving} className="rounded-lg bg-sky-800 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{saving ? '保存中…' : '保存する'}</button>
      <button type="button" disabled={saving} onClick={onCancel} className={buttonClass}>キャンセル</button>
    </div>
  </form>;
}

export default function LunchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params), path = `/api/seminars/${id}/lunch`;
  const [data, setData] = useState<LunchData | null>(null);
  const [editor, setEditor] = useState<LunchPlan | null | undefined>(undefined);
  const [filter, setFilter] = useState<LunchTarget | 'ALL'>('ALL');
  const [error, setError] = useState(''), [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => { const result: LunchData = await apiJson(path); setData(result); }, [path]);
  useEffect(() => {
    const controller = new AbortController();
    apiJson(path, { signal: controller.signal }).then(setData).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [path]);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError(''); setMessage('');
    try { await work(); } catch (error) { setError(error instanceof Error ? error.message : '処理に失敗しました'); }
    finally { setBusy(false); }
  }
  const visible = data?.plans.filter(plan => filter === 'ALL' || lunchTargets(plan).includes(filter)) ?? [];
  const days = [...new Set(visible.map(plan => plan.date))].sort((a, b) => (a ?? '').localeCompare(b ?? ''));
  return <div className="space-y-5">
    <Link href={`/seminars/${id}`} className="text-sm text-sky-800 underline">← イベント詳細に戻る</Link>
    <div><h1 className="text-2xl font-bold">昼食の手配</h1>{data && <p className="mt-1 break-words text-slate-600">{data.event_name}</p>}
      <p className="mt-2 text-sm text-slate-600">開催日・対象ごとに人数（食数）・費用・お店を登録します。店舗への注文・変更・キャンセルは別途連絡してください。</p></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-lg bg-green-50 p-3 text-sm text-green-800">{message}</p>}
    <div className="flex flex-wrap gap-2">
      <button disabled={busy || !data || editor !== undefined} onClick={() => { setMessage(''); setEditor(null); }} className={buttonClass}>＋ 昼食の手配を追加</button>
      <button disabled={busy || editor !== undefined} onClick={() => action(load)} className={buttonClass}>最新情報を取得</button>
    </div>
    {!data && !error && <p>読み込み中…</p>}
    {data && <>
      {data.plans.some(plan => plan.status !== 'CANCELLED' && plan.date && !data.dates.includes(plan.date)) && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">旧日程の手配が残っています。店舗への連絡状況を確認し、日程変更や中止を登録してください。</p>}
      {editor !== undefined && <LunchEditor key={editor?.id ?? 'new'} initial={editor} dates={data.dates} defaults={data.defaults??{}} onCancel={() => setEditor(undefined)} onSave={async input => {
        setBusy(true);
        try {
          const result = await apiJson(editor ? `${path}/${editor.id}` : path, { method: editor ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...input, schedule: data.dates, ...(editor ? { version: editor.version } : {}) }) });
          setData(current => current ? { ...current, plans: [...current.plans.filter(plan => plan.id !== result.plan.id), result.plan] } : current);
          setEditor(undefined); setError(''); setMessage('保存しました');
          try { await load(); } catch { setError('保存済みですが最新情報を取得できませんでした。再取得してください'); }
        } finally { setBusy(false); }
      }} />}
      <label className="block max-w-sm text-sm">対象で絞り込み<select aria-label="対象で絞り込み" value={filter} onChange={e => setFilter(e.target.value as LunchTarget | 'ALL')} className={inputClass}>
        <option value="ALL">すべて</option>{Object.entries(LUNCH_TARGET_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <section aria-label="昼食の集計" className="grid gap-3 sm:grid-cols-2">{days.map(date => {
        const summary = summarizeLunch(visible.filter(plan => plan.date === date));
        return <div key={date ?? ''} className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <h2 className="font-bold">{day(date)}{date && !data.dates.includes(date) ? '（旧日程）' : ''}</h2>
          <p className="mt-2">登録分の食数：{BigInt(summary.quantity).toLocaleString()}食{summary.quantity_unknown > 0 && `（未定${summary.quantity_unknown}件）`}</p>
          <p className="mt-1">計算済みの費用：¥{BigInt(summary.cost).toLocaleString()}{summary.cost_unknown > 0 && `（費用未定${summary.cost_unknown}件）`}</p>
          <p className="mt-2 text-xs text-slate-500">中止を除く、表示している手配全体の集計です。</p>
        </div>;
      })}</section>
      <div className="space-y-4">{visible.map(plan => <article key={plan.id} aria-label={`昼食の手配 ${plan.id}`} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="font-bold">{lunchTargetLabel(plan)}の昼食</h2><p className="mt-1 text-sm text-slate-500">{day(plan.date)}{plan.date && !data.dates.includes(plan.date) ? '（旧日程）' : ''}・{LUNCH_STATUS_LABELS[plan.status]}</p></div>
          <div className="flex gap-2"><button disabled={busy || editor !== undefined} onClick={() => setEditor(plan)} className={buttonClass}>編集</button>
            <button disabled={busy || editor !== undefined} onClick={() => {
              if (!confirm('この昼食の手配記録を削除しますか？店舗へのキャンセル連絡は別途必要です。')) return;
              action(async () => {
                await apiJson(`${path}/${plan.id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version: plan.version }) });
                setData(current => current ? { ...current, plans: current.plans.filter(item => item.id !== plan.id) } : current);
                setMessage('削除しました'); await load();
              });
            }} className={buttonClass}>削除</button></div>
        </div>
        <p className="mt-3 text-sm">{lunchTargets(plan).map(target=>`${LUNCH_TARGET_LABELS[target]}：${lunchQuantities(plan)[target]??'未定'}個`).join(' ／ ')}</p>
        <dl className="mt-4 space-y-2 text-sm">
          {[['対象の詳細', plan.target_details || '未設定'], ['人数・食数', plan.quantity === null ? '未定' : `${plan.quantity.toLocaleString()}人・食`],
            ['1食あたり', yen(plan.unit_price)], ['追加費用', yen(plan.additional_cost)], ['合計費用', yen(lunchCost(plan))],
            ['お店・注文先', plan.shop_name || '未定'], ['連絡先・住所', plan.shop_contact || '未設定'], ['メニュー', plan.menu || '未定'], ['備考', plan.notes || 'なし']].map(([label, value]) => <div key={label} className="flex flex-wrap gap-x-4 gap-y-1">
              <dt className="text-slate-500">{label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words">{value}</dd>
            </div>)}
        </dl>
      </article>)}</div>
      {visible.length === 0 && <p className="py-6 text-center text-slate-500">{data.plans.length ? 'この対象の手配はありません' : '昼食の手配はまだ登録されていません'}</p>}
      <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
        <summary className="cursor-pointer font-bold">変更履歴（直近100件）</summary>
        <ol className="mt-4 space-y-3">{data.history.map(item => <li key={item.id} className="rounded-lg bg-slate-50 p-3">
          <p>{new Date(item.occurred_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}（日本時間）・{item.action === 'created' ? '登録' : item.action === 'updated' ? '更新' : '削除'}</p>
          <p>対象 #{item.plan_id}・操作アカウント #{item.actor_id}</p>
          {item.after && <p>{day(item.after.date)}・{lunchTargetLabel(item.after)}・{LUNCH_STATUS_LABELS[item.after.status]}・{item.after.quantity ?? '未定'}食・合計 {yen(lunchCost(item.after))}</p>}
        </li>)}</ol>{data.history.length === 0 && <p className="mt-3">履歴はありません</p>}
      </details>
    </>}
  </div>;
}
