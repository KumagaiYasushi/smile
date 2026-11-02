'use client';

import { useEffect, useState, use } from 'react';
import { Seminar } from '@/types/seminar';
import { Participant, ROLE_LABELS } from '@/types/participant';
import { todayInTokyo } from '@/types/task';
import { apiJson } from '@/lib/client-api';

type Props = { params: Promise<{ id: string; pid: string }> };

function formatJpDate(dateStr?: string) {
  if (!dateStr) return '未設定';
  const [year, month, day] = dateStr.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

function getFee(seminar: Seminar, role: Participant['role']) {
  if (role === 'dental_hygienist') return seminar.fee_dental_hygienist;
  if (role === 'dentist') return seminar.fee_dentist;
  return seminar.fee_other;
}

export default function ReceiptPage({ params }: Props) {
  const { id, pid } = use(params);
  const [seminar, setSeminar] = useState<Seminar | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [issueDate, setIssueDate] = useState(() => todayInTokyo());

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      apiJson(`/api/seminars/${id}`, { signal: controller.signal }),
      apiJson(`/api/seminars/${id}/participants/${pid}`, { signal: controller.signal }),
    ]).then(([s, p]) => {
      if (controller.signal.aborted) return;
      setSeminar(s);
      setParticipant(p);
      setLoading(false);
    }).catch((error) => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } });
    return () => controller.abort();
  }, [id, pid]);

  if (loading) return <div className="flex items-center justify-center h-screen text-slate-400">読み込み中...</div>;
  if (error) return <div role="alert" className="space-y-3 rounded-xl bg-red-50 p-5 text-red-700"><p>{error}</p><button onClick={() => window.location.reload()} className="underline">再読み込み</button></div>;
  if (!seminar || !participant) return <div className="text-center py-16 text-slate-500">データが見つかりません</div>;

  const fee = getFee(seminar, participant.role);
  const receiptNo = participant.receipt_number || '—';

  return (
    <>
      {/* 印刷ボタン（非印刷時のみ表示）*/}
      <div className="print:hidden bg-slate-100 p-4 flex flex-wrap items-center gap-4 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <label htmlFor="receipt-issue-date" className="text-sm text-slate-600 font-medium">発行日：</label>
          <input
            id="receipt-issue-date"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className="border border-slate-300 rounded px-2 py-1 text-sm"
          />
        </div>
        <button
          onClick={() => window.print()}
          className="bg-sky-700 text-white px-6 py-2 rounded-lg text-sm font-bold hover:bg-sky-600 transition-colors"
        >
          印刷 / PDF保存
        </button>
        <button
          onClick={() => window.close()}
          className="border border-slate-300 text-slate-600 px-4 py-2 rounded-lg text-sm hover:bg-slate-50 transition-colors"
        >
          閉じる
        </button>
      </div>

      {/* 領収書本体 */}
      <div className="min-h-screen bg-white flex items-start justify-center pt-8 print:min-h-0 print:pt-0 print:block">
        <div className="receipt-document w-full max-w-[210mm] min-h-[148mm] bg-white p-5 sm:p-12 print:max-w-none print:min-h-0 print:p-6" style={{ fontFamily: "'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Noto Sans JP', sans-serif" }}>

          {/* タイトル */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold tracking-widest text-slate-900 border-b-2 border-slate-900 pb-3 inline-block px-8">
              領　収　書
            </h1>
          </div>

          {/* 発行日・No */}
          <div className="flex justify-between items-start mb-6">
            <div />
            <div className="text-right text-sm text-slate-600 space-y-1">
              <div>発行日：{formatJpDate(issueDate)}</div>
              {receiptNo !== '—' && <div>No.{receiptNo}</div>}
            </div>
          </div>

          {/* 宛名 */}
          <div className="mb-8">
            <div className="flex items-end gap-2 border-b-2 border-slate-900 pb-2">
              <span className="text-2xl font-bold text-slate-900">{participant.name}</span>
              <span className="text-lg text-slate-700">様</span>
            </div>
            <div className="text-sm text-slate-500 mt-1">{ROLE_LABELS[participant.role]}</div>
          </div>

          {/* 金額 */}
          <div className="mb-8">
            <div className="flex items-center gap-3">
              <span className="text-lg text-slate-700">金額</span>
              <div className="flex-1 border-b border-slate-400" />
              <div className="text-3xl font-bold text-slate-900 tracking-wide">
                ¥ {fee.toLocaleString()} -
              </div>
            </div>
            <div className="text-center text-sm text-slate-500 mt-1">（税込）</div>
          </div>

          {/* 但し書き */}
          <div className="mb-10">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600 whitespace-nowrap">但し</span>
              <div className="flex-1 border-b border-slate-300 pb-1 text-sm text-slate-800">
                {seminar.name}　参加費　として
              </div>
            </div>
            {seminar.dates.length > 0 && (
              <div className="text-xs text-slate-500 mt-2 ml-8">
                開催日：{seminar.dates.map((d) => formatJpDate(d)).join('、')}
              </div>
            )}
            {seminar.venue && (
              <div className="text-xs text-slate-500 mt-1 ml-8">
                会場：{seminar.venue}
              </div>
            )}
          </div>

          {/* 上記正に領収いたしました */}
          <div className="text-center text-sm text-slate-600 mb-10">
            上記正に領収いたしました。
          </div>

          {/* 発行者 */}
          <div className="flex justify-end">
            <div className="text-right space-y-1">
              <div className="text-lg font-bold text-slate-900">歯周基本治療研究会</div>
              {seminar.lecturer_name && (
                <div className="text-sm text-slate-600">{seminar.lecturer_name}</div>
              )}
              <div className="text-xs text-slate-400 mt-2">https://stoptheperio.com</div>
            </div>
          </div>

        </div>
      </div>

      <style>{`
        @media print {
          @page {
            size: A5 landscape;
            margin: 0;
          }
          [data-app-chrome] { display: none !important; }
          [data-app-main] { max-width: none !important; padding: 0 !important; margin: 0 !important; }
          body {
            min-height: 0 !important;
            background: white;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          .receipt-document .mb-8 { margin-bottom: 0.75rem; }
          .receipt-document .mb-6 { margin-bottom: 0.5rem; }
          .receipt-document .mb-10 { margin-bottom: 1rem; }
        }
      `}</style>
    </>
  );
}
