'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Seminar, CHECKLIST_ITEMS } from '@/types/seminar';

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const wday = weekdays[d.getDay()];
  return `${year}年${month}月${day}日（${wday}）`;
}

function formatCurrency(n: number) {
  return n === 0 ? '—' : `¥${n.toLocaleString()}`;
}

type Props = { params: Promise<{ id: string }> };

export default function SeminarDetailPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [seminar, setSeminar] = useState<Seminar | null>(null);
  const [loading, setLoading] = useState(true);
  const [snsCopied, setSnsCopied] = useState(false);
  const [editingSns, setEditingSns] = useState(false);
  const [snsText, setSnsText] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetch(`/api/seminars/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setSeminar(data);
        setSnsText(data.sns_announcement ?? '');
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const toggleChecklist = async (key: keyof Seminar) => {
    if (!seminar) return;
    const updated = { ...seminar, [key]: !seminar[key] };
    setSeminar(updated);
    await fetch(`/api/seminars/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [key]: !seminar[key] }),
    });
  };

  const generateSns = () => {
    if (!seminar) return;
    const dateLines = seminar.dates.map(formatDate).join('\n');
    const fees: string[] = [];
    if (seminar.fee_dental_hygienist > 0) fees.push(`歯科衛生士：${formatCurrency(seminar.fee_dental_hygienist)}`);
    if (seminar.fee_dentist > 0) fees.push(`歯科医師：${formatCurrency(seminar.fee_dentist)}`);
    if (seminar.fee_other > 0) fees.push(`その他：${formatCurrency(seminar.fee_other)}`);

    const text = [
      `【${seminar.name}】`,
      '',
      seminar.content ? `${seminar.content}\n` : '',
      '📅 日程',
      dateLines || '（未定）',
      '',
      seminar.venue ? `📍 会場\n${seminar.venue}\n` : '',
      seminar.lecturer_name ? `👨‍⚕️ 講師\n${seminar.lecturer_name}\n` : '',
      fees.length > 0 ? `💴 参加費\n${fees.join('\n')}\n` : '',
      seminar.target_participants ? `🎯 対象\n${seminar.target_participants}\n` : '',
      '#歯周基本治療研究会 #歯周病 #セミナー #歯科',
    ]
      .filter(Boolean)
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');

    setSnsText(text);
    setEditingSns(true);
  };

  const saveSns = async () => {
    await fetch(`/api/seminars/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sns_announcement: snsText }),
    });
    if (seminar) setSeminar({ ...seminar, sns_announcement: snsText });
    setEditingSns(false);
  };

  const copySns = async () => {
    await navigator.clipboard.writeText(snsText || seminar?.sns_announcement || '');
    setSnsCopied(true);
    setTimeout(() => setSnsCopied(false), 2000);
  };

  const handleDelete = async () => {
    if (!confirm(`「${seminar?.name}」を削除しますか？この操作は取り消せません。`)) return;
    setDeleting(true);
    await fetch(`/api/seminars/${id}`, { method: 'DELETE' });
    router.push('/');
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">読み込み中...</div>;
  if (!seminar) return <div className="text-center py-16 text-slate-500">セミナーが見つかりません</div>;

  const checklistDone = CHECKLIST_ITEMS.filter((item) => seminar[item.key]).length;
  const checklistTotal = CHECKLIST_ITEMS.length;

  return (
    <div className="space-y-6">
      {/* ヘッダー */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-sm text-slate-500 mb-1">
            <Link href="/" className="hover:text-sky-600">← 一覧に戻る</Link>
          </div>
          <h1 className="text-2xl font-bold text-slate-800">{seminar.name}</h1>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          <Link
            href={`/seminars/${id}/edit`}
            className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
          >
            編集
          </Link>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="px-4 py-2 rounded-lg border border-red-200 text-red-500 text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
          >
            削除
          </button>
        </div>
      </div>

      {/* サブナビゲーション */}
      <div className="flex gap-2 flex-wrap">
        <Link
          href={`/seminars/${id}/participants`}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-sky-50 hover:border-sky-300 hover:text-sky-700 transition-all"
        >
          <span>👥</span> 参加者名簿
        </Link>
        <Link
          href={`/seminars/${id}/email-templates`}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-medium text-slate-700 hover:bg-sky-50 hover:border-sky-300 hover:text-sky-700 transition-all"
        >
          <span>✉️</span> メール文面テンプレート
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* 左カラム：基本情報 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 基本情報カード */}
          <Card title="基本情報">
            <dl className="space-y-3">
              <Row label="日程">
                {seminar.dates.length === 0 ? (
                  <span className="text-slate-400">未設定</span>
                ) : (
                  <ul className="space-y-1">
                    {seminar.dates.map((d, i) => (
                      <li key={i} className="text-slate-700">{formatDate(d)}</li>
                    ))}
                  </ul>
                )}
              </Row>
              {seminar.content && (
                <Row label="内容">
                  <p className="text-slate-700 whitespace-pre-wrap">{seminar.content}</p>
                </Row>
              )}
              <Row label="講師">{seminar.lecturer_name || <span className="text-slate-400">未設定</span>}</Row>
              <Row label="アシスタント">
                {seminar.assistant_members.length === 0 ? (
                  <span className="text-slate-400">未設定</span>
                ) : (
                  <span className="text-slate-700">{seminar.assistant_members.join('、')}</span>
                )}
              </Row>
            </dl>
          </Card>

          {/* 参加費カード */}
          <Card title="参加費・対象">
            <dl className="space-y-3">
              <Row label="歯科衛生士">{formatCurrency(seminar.fee_dental_hygienist)}</Row>
              <Row label="歯科医師">{formatCurrency(seminar.fee_dentist)}</Row>
              <Row label="その他">{formatCurrency(seminar.fee_other)}</Row>
              <Row label="参加対象">{seminar.target_participants || <span className="text-slate-400">未設定</span>}</Row>
            </dl>
          </Card>

          {/* 会場カード */}
          <Card title="会場">
            <dl className="space-y-3">
              <Row label="会場">{seminar.venue || <span className="text-slate-400">未設定</span>}</Row>
              <Row label="会場費">{formatCurrency(seminar.venue_fee)}</Row>
            </dl>
          </Card>

          {/* SNS案内文カード */}
          <Card title="SNS 案内文">
            <div className="space-y-3">
              {editingSns ? (
                <>
                  <textarea
                    value={snsText}
                    onChange={(e) => setSnsText(e.target.value)}
                    rows={10}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 resize-y"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={saveSns}
                      className="px-4 py-2 bg-sky-700 text-white rounded-lg text-sm font-bold hover:bg-sky-600 transition-colors"
                    >
                      保存
                    </button>
                    <button
                      onClick={() => { setEditingSns(false); setSnsText(seminar.sns_announcement); }}
                      className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition-colors"
                    >
                      キャンセル
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {seminar.sns_announcement ? (
                    <pre className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 rounded-lg p-3 font-sans leading-relaxed">
                      {seminar.sns_announcement}
                    </pre>
                  ) : (
                    <p className="text-sm text-slate-400">まだ案内文がありません</p>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={generateSns}
                      className="px-4 py-2 bg-sky-700 text-white rounded-lg text-sm font-bold hover:bg-sky-600 transition-colors"
                    >
                      自動生成
                    </button>
                    {seminar.sns_announcement && (
                      <>
                        <button
                          onClick={() => { setSnsText(seminar.sns_announcement); setEditingSns(true); }}
                          className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition-colors"
                        >
                          編集
                        </button>
                        <button
                          onClick={copySns}
                          className="px-4 py-2 border border-slate-300 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition-colors"
                        >
                          {snsCopied ? '✓ コピー済み' : 'コピー'}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          </Card>

          {seminar.notes && (
            <Card title="メモ">
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{seminar.notes}</p>
            </Card>
          )}
        </div>

        {/* 右カラム：チェックリスト */}
        <div>
          <Card title="進行チェックリスト">
            <div className="mb-4">
              <div className="flex justify-between text-sm text-slate-500 mb-2">
                <span>完了</span>
                <span className="font-bold text-slate-700">{checklistDone} / {checklistTotal}</span>
              </div>
              <div className="w-full bg-slate-200 rounded-full h-3">
                <div
                  className={`h-3 rounded-full transition-all ${checklistDone === checklistTotal ? 'bg-green-500' : 'bg-sky-500'}`}
                  style={{ width: `${(checklistDone / checklistTotal) * 100}%` }}
                />
              </div>
              {checklistDone === checklistTotal && (
                <p className="text-xs text-green-600 font-bold mt-2 text-center">✓ すべて完了！</p>
              )}
            </div>

            <ul className="space-y-2">
              {CHECKLIST_ITEMS.map((item) => {
                const checked = Boolean(seminar[item.key]);
                return (
                  <li key={item.key}>
                    <button
                      onClick={() => toggleChecklist(item.key)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left ${
                        checked
                          ? 'bg-green-50 border-green-200 text-green-800'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span className={`w-5 h-5 rounded flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                        checked ? 'bg-green-500 text-white' : 'border-2 border-slate-300'
                      }`}>
                        {checked && '✓'}
                      </span>
                      <span className={`text-sm font-medium ${checked ? 'line-through opacity-70' : ''}`}>
                        {item.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>

          {/* 更新日時 */}
          <div className="mt-4 text-xs text-slate-400 text-center">
            最終更新: {new Date(seminar.updated_at).toLocaleString('ja-JP')}
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5">
      <h2 className="font-bold text-slate-700 text-base mb-4 pb-2 border-b border-slate-100">{title}</h2>
      {children}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <dt className="text-sm text-slate-500 w-24 flex-shrink-0 pt-0.5">{label}</dt>
      <dd className="text-sm flex-1">{children}</dd>
    </div>
  );
}
