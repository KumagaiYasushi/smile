'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import StudyCalendar from '@/components/StudyCalendar';
import { apiJson } from '@/lib/client-api';
import { DASHBOARD_FILTER_LABELS } from '@/types/dashboard';
import type { DashboardData, DashboardFilter } from '@/types/dashboard';
import { TASK_STATUS_LABELS } from '@/types/task';
import { EVENT_TYPE_LABELS } from '@/types/seminar';

export default function DashboardPage() {
  const [filter, setFilter] = useState<DashboardFilter>('ALL');
  const [days, setDays] = useState(7);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams({ filter, days: String(days), page: String(page) });
    apiJson(`/api/dashboard?${query}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) { setData(result); setLoading(false); } })
      .catch((error) => { if (!controller.signal.aborted) { setData(null); setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [filter, days, page, refresh]);

  function selectFilter(value: DashboardFilter) {
    setFilter(value); setPage(1); setError(''); setLoading(true); setRefresh((value) => value + 1);
  }
  function movePage(value: number) {
    setPage(value); setError(''); setLoading(true); setRefresh((value) => value + 1);
  }
  function reload() { setError(''); setLoading(true); setRefresh((value) => value + 1); }

  return <div className="space-y-6" aria-busy={loading}>
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-2xl font-bold text-slate-800">タスクダッシュボード</h1><p className="mt-2 text-sm text-slate-600">全イベントの未完了タスクをまとめて確認できます。</p></div>
      <button disabled={loading} onClick={reload} className="rounded-lg border bg-white px-4 py-2 text-sm disabled:opacity-50">最新の内容を取得</button>
    </div>
    <div className="flex flex-wrap gap-4 text-sm"><Link href="/" className="text-sky-700 underline">イベント一覧へ</Link><Link href="/task-templates" className="text-sky-700 underline">タスクテンプレート</Link></div>
    <StudyCalendar/>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p>}
    {data && <p className="text-sm text-slate-500">基準日：{data.as_of_date}（日本時間）・イベント {data.event_count} 件・未完了タスク {data.counts.ALL} 件</p>}
    <label className="block max-w-sm text-sm font-medium">直近の重要タスクの表示期間
      <select aria-label="直近の重要タスクの表示期間" disabled={loading} value={days} onChange={(event) => { setDays(Number(event.target.value)); setPage(1); setError(''); setLoading(true); }} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-2">
        <option value={3}>今日〜3日後</option><option value={7}>今日〜7日後</option><option value={30}>今日〜30日後</option>
      </select>
    </label>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-label="タスクの集計と絞り込み">
      {(Object.entries(DASHBOARD_FILTER_LABELS) as [DashboardFilter, string][]).map(([value, label]) => <button key={value} disabled={loading} aria-pressed={filter === value} onClick={() => selectFilter(value)} className={`rounded-xl border p-4 text-left disabled:opacity-60 ${filter === value ? 'border-sky-600 bg-sky-50 ring-1 ring-sky-600' : 'border-slate-200 bg-white'}`}>
        <span className="block text-sm text-slate-600">{label}</span>
        <span className={`mt-2 block text-3xl font-bold ${value === 'OVERDUE' && (data?.counts.OVERDUE ?? 0) > 0 ? 'text-red-700' : 'text-slate-800'}`}>{data ? data.counts[value] : '—'}</span>
        {value === 'IMPORTANT' && data && <span className="mt-1 block text-xs text-slate-500">{data.as_of_date}〜{data.through_date}</span>}
      </button>)}
    </div>
    <p className="text-xs text-slate-500">同じタスクが複数の件数に含まれる場合があります。「自分が関わる」は主担当・協力者の両方が対象です。</p>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-lg font-bold">{DASHBOARD_FILTER_LABELS[filter]}</h2>
      <p role="status" className="text-sm text-slate-500">{loading ? '取得中…' : data ? `該当 ${data.total} 件` : '取得できませんでした'}</p>
    </div>
    {!loading && data?.total === 0 && <p className="rounded-xl border bg-white p-8 text-center text-slate-500">{filter === 'ALL' ? '未完了のタスクはありません' : '条件に一致する未完了タスクはありません'}</p>}
    {!loading && data && <>
      <div className="grid items-start gap-4 lg:grid-cols-2">{data.items.map((task) => <article key={task.id} className={`min-w-0 rounded-xl border bg-white p-5 space-y-3 ${task.overdue ? 'border-red-200' : 'border-slate-200'}`}>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-2 py-1">{TASK_STATUS_LABELS[task.status]}</span>
          {task.overdue && <span className="rounded-full bg-red-100 px-2 py-1 text-red-800">期限超過</span>}
          {task.important && <span className="rounded-full bg-amber-100 px-2 py-1 text-amber-900">重要</span>}
          {task.is_primary ? <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-800">自分が主担当</span> : task.is_collaborator ? <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-800">自分が協力者</span> : null}
        </div>
        <h3 className="break-words text-lg font-bold text-slate-800">{task.title}</h3>
        <Link href={`/seminars/${task.seminar_id}`} className="block break-words text-sm text-sky-700 underline">{task.seminar_name}（{EVENT_TYPE_LABELS[task.event_type]}）</Link>
        <p className={`text-sm ${task.overdue ? 'font-medium text-red-700' : 'text-slate-600'}`}>期限：{task.due_date ?? '未設定'}</p>
        <p className="break-all text-sm text-slate-600">主担当：{task.assignee ? `${task.assignee.email}${task.assignee.active ? '' : '（利用停止）'}` : '未割当'}</p>
        <Link href={`/seminars/${task.seminar_id}/tasks`} className="inline-block rounded-lg border border-sky-200 px-4 py-2 text-sm text-sky-800">イベントのタスクを開く</Link>
      </article>)}</div>
      {data.total > 0 && <nav aria-label="タスク一覧のページ切り替え" className="flex flex-wrap items-center justify-center gap-4">
        <button disabled={loading || data.page <= 1} onClick={() => movePage(data.page - 1)} className="rounded-lg border bg-white px-4 py-2 text-sm disabled:opacity-40">前へ</button>
        <p className="text-sm">{data.page} / {Math.max(1, Math.ceil(data.total / data.page_size))} ページ・{(data.page - 1) * data.page_size + 1}〜{Math.min(data.page * data.page_size, data.total)} 件</p>
        <button disabled={loading || data.page * data.page_size >= data.total} onClick={() => movePage(data.page + 1)} className="rounded-lg border bg-white px-4 py-2 text-sm disabled:opacity-40">次へ</button>
      </nav>}
    </>}
  </div>;
}
