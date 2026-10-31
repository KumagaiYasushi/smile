'use client';

import { useEffect, useState, use } from 'react';
import { Seminar } from '@/types/seminar';
import { Participant, ROLE_LABELS } from '@/types/participant';

type Props = { params: Promise<{ id: string; pid: string }> };

function formatJpDate(dateStr?: string) {
  const d = dateStr ? new Date(dateStr) : new Date();
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
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
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    Promise.all([
      fetch(`/api/seminars/${id}`).then((r) => r.json()),
      fetch(`/api/seminars/${id}/participants/${pid}`).then((r) => r.json()),
    ]).then(([s, p]) => {
      setSeminar(s);
      setParticipant(p);
      setLoading(false);
    });
  }, [id, pid]);

  if (loading) return <div className="flex items-center justify-center h-screen text-slate-400">読み込み中...</div>;
  if (!seminar || !participant) return <div className="text-center py-16 text-slate-500">データが見つかりません</div>;

  const fee = getFee(seminar, participant.role);
  const receiptNo = participant.receipt_number || '—';

  return (
    <>
      {/* 印刷ボタン（非印刷時のみ表示）*/}
      <div className="print:hidden bg-slate-100 p-4 flex items-center gap-4 border-b border-slate-200">
        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-600 font-medium">発行日：</label>
          <input
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
      <div className="min-h-screen bg-white flex items-start justify-center pt-8 print:pt-0 print:block">
        <div className="w-[210mm] min-h-[148mm] bg-white p-12 print:p-16" style={{ fontFamily: "'Hiragino Kaku Gothic ProN', 'Hiragino Sans', 'Noto Sans JP', sans-serif" }}>

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
            size: A5;
            margin: 0;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
    </>
  );
}
