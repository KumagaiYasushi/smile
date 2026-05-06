'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Seminar, SeminarInput } from '@/types/seminar';

type Props = {
  initial?: Partial<Seminar>;
  onSubmit: (data: SeminarInput) => Promise<void>;
  submitLabel: string;
};

export default function SeminarForm({ initial, onSubmit, submitLabel }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState(initial?.name ?? '');
  const [dates, setDates] = useState<string[]>(initial?.dates ?? ['']);
  const [content, setContent] = useState(initial?.content ?? '');
  const [lecturerName, setLecturerName] = useState(initial?.lecturer_name ?? '');
  const [assistants, setAssistants] = useState<string[]>(
    initial?.assistant_members?.length ? initial.assistant_members : ['']
  );
  const [feeDH, setFeeDH] = useState(String(initial?.fee_dental_hygienist ?? ''));
  const [feeDr, setFeeDr] = useState(String(initial?.fee_dentist ?? ''));
  const [feeOther, setFeeOther] = useState(String(initial?.fee_other ?? ''));
  const [targetParticipants, setTargetParticipants] = useState(initial?.target_participants ?? '');
  const [venue, setVenue] = useState(initial?.venue ?? '');
  const [venueFee, setVenueFee] = useState(String(initial?.venue_fee ?? ''));
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const updateDate = (i: number, value: string) => {
    const next = [...dates];
    next[i] = value;
    setDates(next);
  };
  const addDate = () => setDates([...dates, '']);
  const removeDate = (i: number) => setDates(dates.filter((_, idx) => idx !== i));

  const updateAssistant = (i: number, value: string) => {
    const next = [...assistants];
    next[i] = value;
    setAssistants(next);
  };
  const addAssistant = () => setAssistants([...assistants, '']);
  const removeAssistant = (i: number) => setAssistants(assistants.filter((_, idx) => idx !== i));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('セミナー名は必須です');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSubmit({
        name: name.trim(),
        dates: dates.filter((d) => d.trim()),
        content,
        lecturer_name: lecturerName,
        assistant_members: assistants.filter((a) => a.trim()),
        fee_dental_hygienist: Number(feeDH) || 0,
        fee_dentist: Number(feeDr) || 0,
        fee_other: Number(feeOther) || 0,
        target_participants: targetParticipants,
        venue,
        venue_fee: Number(venueFee) || 0,
        sns_announcement: initial?.sns_announcement ?? '',
        lecturer_invitation_sent: initial?.lecturer_invitation_sent ?? false,
        photo_received: initial?.photo_received ?? false,
        abstract_300_requested: initial?.abstract_300_requested ?? false,
        abstract_800_requested: initial?.abstract_800_requested ?? false,
        receipt_issued: initial?.receipt_issued ?? false,
        notes,
      });
    } catch {
      setError('保存に失敗しました');
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <Section title="基本情報">
        <Field label="セミナー名" required>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：歯周基本治療セミナー 第1回"
            className={inputClass}
          />
        </Field>

        <Field label="日程">
          <div className="space-y-2">
            {dates.map((d, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  type="date"
                  value={d}
                  onChange={(e) => updateDate(i, e.target.value)}
                  className={`${inputClass} flex-1`}
                />
                {dates.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeDate(i)}
                    className="text-slate-400 hover:text-red-500 transition-colors text-lg leading-none px-1"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addDate}
              className="text-sm text-sky-600 hover:text-sky-800 font-medium"
            >
              ＋ 日程を追加
            </button>
          </div>
        </Field>

        <Field label="セミナー内容">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            placeholder="セミナーの内容・目的など"
            className={textareaClass}
          />
        </Field>
      </Section>

      <Section title="講師・スタッフ">
        <Field label="講師名">
          <input
            type="text"
            value={lecturerName}
            onChange={(e) => setLecturerName(e.target.value)}
            placeholder="例：山田 太郎"
            className={inputClass}
          />
        </Field>

        <Field label="アシスタントメンバー">
          <div className="space-y-2">
            {assistants.map((a, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  type="text"
                  value={a}
                  onChange={(e) => updateAssistant(i, e.target.value)}
                  placeholder="氏名"
                  className={`${inputClass} flex-1`}
                />
                {assistants.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeAssistant(i)}
                    className="text-slate-400 hover:text-red-500 transition-colors text-lg leading-none px-1"
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={addAssistant}
              className="text-sm text-sky-600 hover:text-sky-800 font-medium"
            >
              ＋ メンバーを追加
            </button>
          </div>
        </Field>
      </Section>

      <Section title="参加費">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="歯科衛生士（円）">
            <input
              type="number"
              value={feeDH}
              onChange={(e) => setFeeDH(e.target.value)}
              min={0}
              step={100}
              placeholder="0"
              className={inputClass}
            />
          </Field>
          <Field label="歯科医師（円）">
            <input
              type="number"
              value={feeDr}
              onChange={(e) => setFeeDr(e.target.value)}
              min={0}
              step={100}
              placeholder="0"
              className={inputClass}
            />
          </Field>
          <Field label="その他（円）">
            <input
              type="number"
              value={feeOther}
              onChange={(e) => setFeeOther(e.target.value)}
              min={0}
              step={100}
              placeholder="0"
              className={inputClass}
            />
          </Field>
        </div>

        <Field label="参加対象">
          <input
            type="text"
            value={targetParticipants}
            onChange={(e) => setTargetParticipants(e.target.value)}
            placeholder="例：歯科衛生士、歯科医師"
            className={inputClass}
          />
        </Field>
      </Section>

      <Section title="会場">
        <Field label="会場名・住所">
          <input
            type="text"
            value={venue}
            onChange={(e) => setVenue(e.target.value)}
            placeholder="例：〇〇歯科医師会館 3F 大会議室"
            className={inputClass}
          />
        </Field>
        <Field label="会場費（円）">
          <input
            type="number"
            value={venueFee}
            onChange={(e) => setVenueFee(e.target.value)}
            min={0}
            step={1000}
            placeholder="0"
            className={`${inputClass} max-w-xs`}
          />
        </Field>
      </Section>

      <Section title="メモ">
        <Field label="その他メモ">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="自由記入欄"
            className={textareaClass}
          />
        </Field>
      </Section>

      <div className="flex gap-3 justify-end pt-4 border-t border-slate-200">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-5 py-2.5 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2.5 rounded-lg bg-sky-700 text-white text-sm font-bold hover:bg-sky-600 disabled:opacity-50 transition-colors"
        >
          {saving ? '保存中...' : submitLabel}
        </button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-base font-bold text-slate-700 mb-4 pb-2 border-b border-slate-200">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

const inputClass =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent transition-shadow';

const textareaClass =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent transition-shadow resize-y';
