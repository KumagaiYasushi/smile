'use client';

import { useEffect, useState, use } from 'react';
import Link from 'next/link';
import { Seminar } from '@/types/seminar';

type Props = { params: Promise<{ id: string }> };

type Template = {
  id: string;
  label: string;
  description: string;
  generate: (s: Seminar) => string;
};

function formatDate(dateStr: string) {
  const d = new Date(dateStr);
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${year}年${month}月${day}日（${weekdays[d.getDay()]}）`;
}

function feeText(seminar: Seminar) {
  const lines = [];
  if (seminar.fee_dental_hygienist > 0) lines.push(`　歯科衛生士：¥${seminar.fee_dental_hygienist.toLocaleString()}`);
  if (seminar.fee_dentist > 0) lines.push(`　歯科医師　：¥${seminar.fee_dentist.toLocaleString()}`);
  if (seminar.fee_other > 0) lines.push(`　その他　　：¥${seminar.fee_other.toLocaleString()}`);
  return lines.join('\n') || '　（未設定）';
}

const TEMPLATES: Template[] = [
  {
    id: 'lecturer_invitation',
    label: '講師依頼メール',
    description: '講師の先生へのセミナー登壇依頼',
    generate: (s) => `件名：【${s.name}】講師ご登壇のお願い

○○先生

平素より大変お世話になっております。
歯周基本治療研究会の○○と申します。

この度、下記のとおりセミナーを開催する運びとなりました。
つきましては、先生にご講師をお願いしたく、ご連絡申し上げます。

─────────────────────────
■ セミナー名
${s.name}

■ 開催日程
${s.dates.length > 0 ? s.dates.map(formatDate).join('\n') : '（未定）'}

■ 会場
${s.venue || '（未定）'}
─────────────────────────

お忙しいところ誠に恐れ入りますが、ご検討いただけますようよろしくお願い申し上げます。
ご承諾いただける場合は、▲▲年▲▲月▲▲日までにご連絡いただけますと幸いです。

ご不明な点がございましたら、お気軽にお申し付けください。

何卒よろしくお願いいたします。

歯周基本治療研究会
○○ ○○
E-mail：
TEL：
https://stoptheperio.com`,
  },
  {
    id: 'abstract_300',
    label: '抄録依頼（300字）メール',
    description: '講師への300字抄録提出依頼',
    generate: (s) => `件名：【${s.name}】抄録（300字）のご提出のお願い

${s.lecturer_name || '○○先生'}

お世話になっております。歯周基本治療研究会の○○です。

${s.name}にご登壇いただきありがとうございます。
つきましては、プログラム掲載用の抄録をご提出いただけますようお願いいたします。

─────────────────────────
■ 文字数：300字以内
■ 提出期限：▲▲年▲▲月▲▲日（▲）まで
■ 提出方法：このメールへの返信にてご送付ください
─────────────────────────

【記載内容の目安】
・講義のテーマ・目的
・主な内容・トピック
・参加者が得られる知識・スキル

お忙しい中恐縮ですが、何卒よろしくお願いいたします。

歯周基本治療研究会
○○ ○○
https://stoptheperio.com`,
  },
  {
    id: 'abstract_800',
    label: '抄録依頼（800字）メール',
    description: '講師への800字抄録提出依頼',
    generate: (s) => `件名：【${s.name}】抄録（800字）のご提出のお願い

${s.lecturer_name || '○○先生'}

お世話になっております。歯周基本治療研究会の○○です。

${s.name}にご登壇いただきありがとうございます。
当日配布するテキスト掲載用の詳細抄録をご提出いただけますようお願いいたします。

─────────────────────────
■ 文字数：800字以内
■ 提出期限：▲▲年▲▲月▲▲日（▲）まで
■ 提出方法：このメールへの返信にてご送付ください
─────────────────────────

【記載内容の目安】
・背景・目的
・主な内容・症例・エビデンス
・結論・臨床への応用
・参加者へのメッセージ

ご不明な点はお気軽にお申し付けください。
何卒よろしくお願いいたします。

歯周基本治療研究会
○○ ○○
https://stoptheperio.com`,
  },
  {
    id: 'photo_request',
    label: '顔写真依頼メール',
    description: '講師への顔写真送付依頼',
    generate: (s) => `件名：【${s.name}】顔写真のご送付のお願い

${s.lecturer_name || '○○先生'}

お世話になっております。歯周基本治療研究会の○○です。

${s.name}にご登壇いただきありがとうございます。
プログラム・告知物に掲載するため、先生のお顔写真をお送りいただけますでしょうか。

─────────────────────────
■ 提出期限：▲▲年▲▲月▲▲日（▲）まで
■ ファイル形式：JPEG または PNG
■ 推奨サイズ：縦横各 300px 以上（縦長推奨）
■ 提出方法：このメールへの返信にてご送付ください
─────────────────────────

お忙しいところ恐れ入りますが、よろしくお願いいたします。

歯周基本治療研究会
○○ ○○
https://stoptheperio.com`,
  },
  {
    id: 'participant_invitation',
    label: '参加案内メール',
    description: '参加者・会員への開催案内',
    generate: (s) => `件名：【参加者募集】${s.name}

会員の皆様

平素より大変お世話になっております。
歯周基本治療研究会の○○です。

下記のとおりセミナーを開催いたします。ぜひご参加ください。

━━━━━━━━━━━━━━━━━━━━━
【${s.name}】
━━━━━━━━━━━━━━━━━━━━━

■ 開催日程
${s.dates.length > 0 ? s.dates.map(formatDate).join('\n') : '（調整中）'}

■ 会場
${s.venue || '（調整中）'}
${s.content ? `\n■ 内容\n${s.content}\n` : ''}
■ 講師
${s.lecturer_name || '（調整中）'}

■ 参加費
${feeText(s)}

■ 対象
${s.target_participants || '歯科医師・歯科衛生士'}

─────────────────────────
ご参加を希望される方は、▲▲年▲▲月▲▲日（▲）までに下記までご連絡ください。

歯周基本治療研究会
担当：○○ ○○
E-mail：
TEL：
https://stoptheperio.com`,
  },
  {
    id: 'reminder',
    label: 'リマインダーメール',
    description: '参加者へ開催1週間前のリマインド',
    generate: (s) => `件名：【開催間近】${s.name}のご案内

○○様

お世話になっております。歯周基本治療研究会の○○です。

先日お申し込みいただきました下記セミナーが近づいてまいりましたので、
改めてご案内申し上げます。

─────────────────────────
■ セミナー名
${s.name}

■ 開催日程
${s.dates.length > 0 ? s.dates.map(formatDate).join('\n') : '（要確認）'}

■ 会場
${s.venue || '（要確認）'}
─────────────────────────

当日は名刺をお持ちいただけますと幸いです。
会場へのアクセスに関してご不明な点がございましたら、
お気軽にお問い合わせください。

皆様のご参加を心よりお待ちしております。

歯周基本治療研究会
○○ ○○
E-mail：
TEL：
https://stoptheperio.com`,
  },
  {
    id: 'venue_reservation',
    label: '会場予約メール',
    description: '会場担当者への予約連絡',
    generate: (s) => `件名：会場使用のご予約について

○○様（ご担当者様）

お世話になっております。歯周基本治療研究会の○○と申します。

下記の日程で貴施設の会場をご利用させていただきたく、ご連絡いたしました。

─────────────────────────
■ 使用目的：歯科セミナー開催
■ セミナー名：${s.name}
■ 希望日程：${s.dates.length > 0 ? s.dates.map(formatDate).join(' / ') : '（未定）'}
■ 会場：${s.venue || '（ご相談）'}
■ 想定参加人数：　　名（予定）
■ 使用時間：　：　〜　：　（搬入・撤収含む）
─────────────────────────

ご確認いただき、ご対応のほどよろしくお願いいたします。
ご不明な点がございましたら、お気軽にお申し付けください。

歯周基本治療研究会
○○ ○○
E-mail：
TEL：
https://stoptheperio.com`,
  },
];

export default function EmailTemplatesPage({ params }: Props) {
  const { id } = use(params);
  const [seminar, setSeminar] = useState<Seminar | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string>(TEMPLATES[0].id);
  const [text, setText] = useState('');
  const [copied, setCopied] = useState(false);
  const [edited, setEdited] = useState(false);

  useEffect(() => {
    fetch(`/api/seminars/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setSeminar(data);
        setLoading(false);
        const tpl = TEMPLATES.find((t) => t.id === selected);
        if (tpl) setText(tpl.generate(data));
      });
  }, [id]);

  const handleSelectTemplate = (tplId: string) => {
    if (edited && !confirm('編集内容が破棄されます。よろしいですか？')) return;
    setSelected(tplId);
    setEdited(false);
    if (seminar) {
      const tpl = TEMPLATES.find((t) => t.id === tplId);
      if (tpl) setText(tpl.generate(seminar));
    }
  };

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    if (!seminar) return;
    const tpl = TEMPLATES.find((t) => t.id === selected);
    if (tpl) { setText(tpl.generate(seminar)); setEdited(false); }
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">読み込み中...</div>;
  if (!seminar) return <div className="text-center py-16 text-slate-500">セミナーが見つかりません</div>;

  const currentTpl = TEMPLATES.find((t) => t.id === selected)!;

  return (
    <div className="space-y-6">
      <div>
        <div className="text-sm text-slate-500 mb-1">
          <Link href={`/seminars/${id}`} className="hover:text-sky-600">← {seminar.name}</Link>
        </div>
        <h1 className="text-2xl font-bold text-slate-800">メール文面テンプレート</h1>
        <p className="text-slate-500 text-sm mt-1">セミナー情報を自動で埋め込んだメール文面を生成します。▲▲ の部分は手動で修正してください。</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* テンプレート選択 */}
        <div>
          <h2 className="text-sm font-bold text-slate-600 mb-3">テンプレートを選択</h2>
          <ul className="space-y-2">
            {TEMPLATES.map((tpl) => (
              <li key={tpl.id}>
                <button
                  onClick={() => handleSelectTemplate(tpl.id)}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${
                    selected === tpl.id
                      ? 'bg-sky-50 border-sky-300 text-sky-800'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="font-medium text-sm">{tpl.label}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{tpl.description}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* テキストエディタ */}
        <div className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-600">{currentTpl.label}</h2>
            <div className="flex gap-2">
              {edited && (
                <button
                  onClick={handleReset}
                  className="text-xs text-slate-500 hover:text-slate-700 border border-slate-300 px-3 py-1.5 rounded-lg"
                >
                  リセット
                </button>
              )}
              <button
                onClick={handleCopy}
                className="text-xs bg-sky-700 text-white px-4 py-1.5 rounded-lg font-bold hover:bg-sky-600 transition-colors"
              >
                {copied ? '✓ コピー済み' : 'コピー'}
              </button>
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setEdited(true); }}
            rows={28}
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent resize-y leading-relaxed"
          />
          <p className="text-xs text-slate-400 mt-2">
            テキストを直接編集できます。▲▲ はプレースホルダーです。コピーしてメールソフトに貼り付けてください。
          </p>
        </div>
      </div>
    </div>
  );
}
