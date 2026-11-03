import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getAllSeminars } from '@/lib/db';
import { EVENT_TYPE_LABELS, deliveryMethodLabel } from '@/types/seminar';

export default function VerificationPage() {
  if (process.env.SMILE_VERIFICATION_MODE !== '1') notFound();
  const examples = getAllSeminars().filter(event => event.name.startsWith('【検証】'));
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold text-slate-800">操作検証ページ</h1>
      <p className="mt-2 text-sm text-slate-600">架空のサンプルを使って、登録・編集・保存をお試しください。変更はこの検証環境に保存されます。</p></div>
    <section className="rounded-2xl border border-sky-200 bg-sky-50 p-5">
      <h2 className="font-bold">まず確認すること</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-700">
        <li>イベント編集で「単回・複数回」を選択する。開催日は年月日だけが初期状態で、時刻は必要な日だけ設定する。</li>
        <li>「講師・サポートの出欠予定」で、外部講師・研究会講師・研究会サポートメンバーを選び、日程別の出欠予定を登録する。</li>
        <li>全イベントの「昼食の手配」で、保存後に対象・人数・費用・お店を登録・編集する。</li>
        <li>「会場台帳」で会場を登録し、イベント編集画面から選択する。</li>
        <li>日程変更後のタスク期限、出欠予定、昼食、懇親会の情報を確認する。</li>
        <li>「参加者・領収書」で支払方法を銀行振込にし、実際の入金額を確認して保存後、「領収書を発行」を選ぶ。</li>
      </ol>
    </section>
    <section aria-label="検証用サンプル" className="grid gap-4 lg:grid-cols-3">{examples.map(event => <article key={event.id} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5">
      <p className="text-xs text-sky-800">{EVENT_TYPE_LABELS[event.event_type]}・{deliveryMethodLabel(event.delivery_method)}</p>
      <h2 className="mt-2 break-words font-bold">{event.name}</h2><p className="mt-2 text-sm text-slate-500">{event.dates.join('、') || '日程未定'}</p>
      <div className="mt-4 flex flex-col items-start gap-3 text-sm">
        <Link href={`/seminars/${event.id}`} className="rounded-lg bg-sky-800 px-4 py-2 font-bold text-white">イベントを開く</Link>
        <Link href={`/seminars/${event.id}/staff-attendance`} className="text-sky-800 underline">講師・サポートの出欠予定</Link>
        <Link href={`/seminars/${event.id}/lunch`} className="text-sky-800 underline">昼食の手配</Link>
        <Link href={`/seminars/${event.id}/tasks`} className="text-sky-800 underline">タスク・期限管理</Link>
        <Link href={`/seminars/${event.id}/participants`} className="text-sky-800 underline">参加者・領収書</Link>
      </div>
    </article>)}</section>
    {examples.length === 0 && <p className="text-sm text-slate-500">サンプルがありません。新規イベントから検証用のイベントを作成できます。</p>}
    <div className="flex flex-wrap gap-3 text-sm"><Link href="/seminars/new" className="rounded-lg border border-slate-300 bg-white px-4 py-2">新規イベントを試す</Link>
      <Link href="/venues" className="rounded-lg border border-slate-300 bg-white px-4 py-2">会場台帳を試す</Link>
      <Link href="/dashboard" className="rounded-lg border border-slate-300 bg-white px-4 py-2">ダッシュボードを確認</Link></div>
    <p className="text-xs text-slate-500">実在する参加者情報や注文は登録せず、架空データで確認してください。メールは文面の生成・コピーを試せます。</p>
  </div>;
}
