'use client';

import { useState, useId, isValidElement, cloneElement } from 'react';
import { useRouter } from 'next/navigation';
import { Seminar, SeminarSubmission, EventType, EVENT_TYPE_LABELS, DeliveryMethod, DELIVERY_METHOD_LABELS } from '@/types/seminar';
import Link from 'next/link';
import { emptySocialGathering, parseSocialGathering, SOCIAL_STATUS_LABELS } from '@/types/social-gathering';
import type { SocialGathering, SocialStatus } from '@/types/social-gathering';
import VenuePicker from '@/components/VenuePicker';
import SocietyMemberPicker from '@/components/SocietyMemberPicker';
import { emptyRepeatFees, parseRepeatFees,parseSessionMethods } from '@/types/event-options';
import type { SessionMethods } from '@/types/event-options';
import EventTimesEditor from '@/components/EventTimesEditor';
import { OCCURRENCE_LABELS, validateOccurrences, parseEventTimes } from '@/types/event-schedule';
import type { OccurrenceType, EventTimes } from '@/types/event-schedule';

type Props = {
  initial?: Partial<Seminar>;
  onSubmit: (data: SeminarSubmission) => Promise<void>;
  submitLabel: string;
};

export default function SeminarForm({ initial, onSubmit, submitLabel }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState(initial?.name ?? '');
  const [eventType, setEventType] = useState<EventType>(initial?.event_type ?? 'SEMINAR');
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod | ''>(initial?.delivery_method ?? '');
  const [dates, setDates] = useState<string[]>(initial?.dates ?? ['']);
  const [occurrence, setOccurrence] = useState<OccurrenceType | ''>(initial?.occurrence_type ?? '');
  const [eventTimes, setEventTimes] = useState<EventTimes>(initial?.event_times ?? {});
  const [sessionMethods,setSessionMethods]=useState<SessionMethods>(initial ? {...Object.fromEntries((initial.dates??[]).filter(()=>initial.delivery_method).map(date=>[date,initial.delivery_method!])),...initial.session_delivery_methods} : {});
  const [repeatFees,setRepeatFees]=useState<Record<'dental_hygienist'|'dentist'|'other',string>>(()=>Object.fromEntries(Object.entries(initial?.repeat_fees??emptyRepeatFees()).map(([role,fee])=>[role,fee===null?'':String(fee)])) as Record<'dental_hygienist'|'dentist'|'other',string>);
  const [lecturerRole, setLecturerRole] = useState(initial?.lecturer_role ?? '');
  const [generateTasks, setGenerateTasks] = useState(true);
  const [taskBaseDate, setTaskBaseDate] = useState('');
  const validDates = [...new Set(dates.filter(Boolean))];
  const baseDate = validDates.includes(taskBaseDate) ? taskBaseDate : validDates.length === 1 ? validDates[0] : '';
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
  const [venueId, setVenueId] = useState<number | null>(initial?.venue_id ?? null);
  const [venueFee, setVenueFee] = useState(String(initial?.venue_fee ?? ''));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [social, setSocial] = useState<SocialGathering>(() => initial?.social_gathering ?? emptySocialGathering());
  const [socialFee, setSocialFee] = useState(String(initial?.social_gathering?.fee ?? ''));

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
    const form=e.currentTarget as HTMLFormElement;
    if(!form.checkValidity()) {
      const invalid=form.querySelector<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input:invalid,select:invalid,textarea:invalid');
      const label=invalid?.getAttribute('aria-label')??invalid?.labels?.[0]?.textContent?.trim()??'入力項目';
      setError(`「${label}」を確認してください。${invalid?.validity.valueMissing?'入力または選択してください。':'入力形式・金額・時刻の範囲を確認してください。'}`);
      invalid?.reportValidity();
      return;
    }
    if (!name.trim()) {
      setError('セミナー名は必須です');
      return;
    }
    if (!deliveryMethod && !(occurrence==='MULTIPLE'&&validDates.length>0)) {
      setError('開催方法を選択してください');
      return;
    }
    setSaving(true);
    setError('');
    try {
      validateOccurrences(occurrence, validDates);
      const methods=parseSessionMethods(occurrence==='MULTIPLE'?Object.fromEntries(validDates.map(date=>[date,sessionMethods[date]])):{},validDates);
      const repeat=parseRepeatFees(Object.fromEntries(Object.entries(repeatFees).map(([role,fee])=>[role,fee===''?null:Number(fee)])));
      const times = parseEventTimes(Object.fromEntries(Object.entries(eventTimes).filter(([date]) => validDates.includes(date))), validDates);
      await onSubmit({
        ...(!initial?.id ? { generate_tasks: generateTasks && validDates.length>0, ...(generateTasks && baseDate ? { task_base_date: baseDate } : {}) } : {}),
        event_type: eventType,
        delivery_method: deliveryMethod || methods[validDates[0]],
        occurrence_type: occurrence as OccurrenceType,
        session_delivery_methods: methods,
        repeat_fees: repeat,
        event_times: times,
        lecturer_role: lecturerRole ? lecturerRole as 'EXTERNAL_LECTURER' | 'SOCIETY_LECTURER' : null,
        social_gathering: parseSocialGathering({ ...social, fee: socialFee === '' ? null : Number(socialFee) }),
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
        venue_id: venueId,
        venue_fee: Number(venueFee) || 0,
        sns_announcement: initial?.sns_announcement ?? '',
        lecturer_invitation_sent: initial?.lecturer_invitation_sent ?? false,
        photo_received: initial?.photo_received ?? false,
        abstract_300_requested: initial?.abstract_300_requested ?? false,
        abstract_800_requested: initial?.abstract_800_requested ?? false,
        receipt_issued: initial?.receipt_issued ?? false,
        notes,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : '保存に失敗しました');
      setSaving(false);
    }
  };

  return (
    <form noValidate onSubmit={handleSubmit} className="space-y-8">
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <Section title="基本情報">
        {!initial?.id && <div className="rounded-xl bg-sky-50 p-4 space-y-3 text-sm">
          <label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={generateTasks} onChange={(e) => setGenerateTasks(e.target.checked)} />種別のテンプレートからタスクを自動生成する</label>
          <p>有効なテンプレートがある場合、開催日を基準に期限を計算します。担当者は作成後に割り当てられます。</p>
          <Link href="/task-templates" className="inline-block text-sky-800 underline">タスクテンプレートを管理</Link>
          {generateTasks && validDates.length > 0 && <label className="block font-medium">タスク期限の基準日
            <select aria-label="タスク期限の基準日" required value={baseDate} onChange={(e) => setTaskBaseDate(e.target.value)} className={inputClass}>
              <option value="">開催日から選択してください</option>
              {validDates.map((date) => <option key={date} value={date}>{date}</option>)}
            </select>
          </label>}
          {generateTasks && validDates.length === 0 && <p>日程未定でも登録できます。タスクは日程確定後にプレビューして追加してください。</p>}
        </div>}
        <div>
          <label htmlFor="event-type" className="block text-sm font-medium text-slate-700 mb-1.5">イベント種別</label>
          <select id="event-type" value={eventType} onChange={(e) => setEventType(e.target.value as EventType)} className={inputClass}>
            {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <Field label="開催方法" required={occurrence!=='MULTIPLE'||!validDates.length}>
          <select required={occurrence!=='MULTIPLE'||!validDates.length} value={deliveryMethod} onChange={(e) => setDeliveryMethod(e.target.value as DeliveryMethod | '')} className={inputClass}>
            <option value="" disabled>選択してください</option>
            {Object.entries(DELIVERY_METHOD_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        {occurrence==='MULTIPLE'&&<p className="text-xs text-slate-500">上の開催方法は日程未定時の共通設定です。日程が決まっている回は、下の「各回の開催方法」を使います。</p>}
        <Field label="開催回数" required>
          <select required value={occurrence} onChange={e => setOccurrence(e.target.value as OccurrenceType | '')} className={inputClass}>
            <option value="" disabled>選択してください</option>
            {Object.entries(OCCURRENCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <p className="text-xs text-slate-500">単回は1日、複数回は開催日を追加できます。日程未定でも開催回数は選択してください。</p>
        <Field label="セミナー名" required>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：歯周基本治療セミナー 第1回"
            className={inputClass}
          />
        </Field>

        <Field label="日程">
          {initial?.id ? <div className="space-y-2 text-sm">
            <p>{validDates.join('、') || '日程未定'}</p>
            <Link href={`/seminars/${initial.id}/reschedule`} className="text-sky-800 underline">開催日・期限変更でプレビューする</Link>
          </div> : <div className="space-y-2">
            {dates.map((d, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  type="date"
                  aria-label={`開催日 ${i + 1}`}
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
            {occurrence === 'MULTIPLE' && <button
              type="button"
              onClick={addDate}
              className="text-sm text-sky-600 hover:text-sky-800 font-medium"
            >
              ＋ 日程を追加
            </button>}
          </div>}
        </Field>
        {occurrence==='MULTIPLE'&&<fieldset className="space-y-3"><legend className="mb-2 font-medium">各回の開催方法</legend>
          <p className="text-xs text-slate-500">開催日ごとに選択してください。日程未定の間は上の開催方法を保存します。</p>
          {validDates.map(date=><label key={date} className="block text-sm">{date}の開催方法<select aria-label={`${date}の開催方法`} required value={sessionMethods[date]??''} onChange={e=>setSessionMethods({...sessionMethods,[date]:e.target.value as DeliveryMethod})} className={inputClass}><option value="">選択してください</option>{Object.entries(DELIVERY_METHOD_LABELS).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>)}
        </fieldset>}
        <EventTimesEditor dates={validDates} value={eventTimes} onChange={setEventTimes} />

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
        <p className="text-sm text-slate-600">保存後の「講師・サポートの出欠予定」で、外来講師・研究会講師・研究会サポートメンバーを複数名登録できます。</p>
        <Field label="講師区分">
          <select value={lecturerRole} onChange={e => {setLecturerRole(e.target.value);setLecturerName('');}} className={inputClass}>
            <option value="">区分を選択してください</option>
            <option value="EXTERNAL_LECTURER">外来講師</option><option value="SOCIETY_LECTURER">研究会講師</option>
          </select>
        </Field>
        {lecturerRole==='SOCIETY_LECTURER'?<SocietyMemberPicker role="SOCIETY_LECTURER" label="講師名" value={lecturerName} onChange={setLecturerName}/>:<Field label="講師名"><input type="text" value={lecturerName} onChange={e=>setLecturerName(e.target.value)} placeholder="外来講師の氏名" className={inputClass}/></Field>}

        <Field label="研究会サポートメンバー">
          <div className="space-y-2">
            {assistants.map((a, i) => (
              <div key={i} className="flex gap-2 items-center">
                <div className="min-w-0 flex-1"><SocietyMemberPicker role="SOCIETY_SUPPORT" label={`研究会サポートメンバー ${i+1}`} value={a} onChange={value=>updateAssistant(i,value)}/></div>
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
        {occurrence==='MULTIPLE'&&<h3 className="font-medium">複数回合計金額</h3>}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="歯科衛生士（円）">
            <input
              type="number"
              value={feeDH}
              onChange={(e) => setFeeDH(e.target.value)}
              min={0}
              step={1}
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
              step={1}
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
              step={1}
              placeholder="0"
              className={inputClass}
            />
          </Field>
        </div>

        {occurrence==='MULTIPLE'&&<fieldset className="space-y-3"><legend className="mb-2 font-medium">単回金額（再受講用）</legend><p className="text-xs text-slate-500">1回あたりの金額です。空欄は未設定、0円は無料です。</p><div className="grid gap-4 sm:grid-cols-3">{([['dental_hygienist','歯科衛生士'],['dentist','歯科医師'],['other','その他']] as const).map(([role,label])=><label key={role} className="block text-sm">{label}・再受講1回（円）<input aria-label={`${label}・再受講1回（円）`} type="number" min="0" step="1" value={repeatFees[role]} onChange={e=>setRepeatFees({...repeatFees,[role]:e.target.value})} className={inputClass}/></label>)}</div></fieldset>}
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
        {deliveryMethod === 'ONLINE' && <p className="text-sm text-slate-500">配信拠点などの内部記録に使用できます。オンライン開催の案内文には会場を掲載しません。</p>}
        <VenuePicker value={venueId} onSelect={(id, location) => { setVenueId(id); if (location !== undefined) setVenue(location); }} onReferenceFee={fee => setVenueFee(String(fee))} />
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
            step={1}
            placeholder="0"
            className={`${inputClass} max-w-xs`}
          />
        </Field>
      </Section>

      <Section title="昼食の手配">
        <p className="text-sm text-slate-600">ベーシックコース・講演会・セミナーのすべてで、保存後に対象・人数・費用・お店を登録できます。</p>
        {initial?.id && <Link href={`/seminars/${initial.id}/lunch`} className="inline-block text-sm text-sky-800 underline">昼食の手配を登録・確認する</Link>}
      </Section>

      <Section title="懇親会">
        <Field label="懇親会の開催">
          <select value={social.status} onChange={e => setSocial({ ...social, status: e.target.value as SocialStatus })} className={inputClass}>
            {Object.entries(SOCIAL_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <p className="text-sm text-slate-500">日時・場所・参加費が未定でも保存できます。「開催しない」に変更しても入力済みの情報は保持します。</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="懇親会の開始日時（日本時間）">
            <input type="datetime-local" value={social.start_at ?? ''} onChange={e => setSocial({ ...social, start_at: e.target.value || null })} className={`${inputClass} min-w-0`} />
          </Field>
          <Field label="懇親会の終了日時（日本時間）">
            <input type="datetime-local" value={social.end_at ?? ''} min={social.start_at ?? undefined} onChange={e => setSocial({ ...social, end_at: e.target.value || null })} className={`${inputClass} min-w-0`} />
          </Field>
        </div>
        <Field label="懇親会の場所・住所">
          <textarea rows={2} maxLength={2000} value={social.venue} onChange={e => setSocial({ ...social, venue: e.target.value })} placeholder="例：〇〇レストラン、住所" className={textareaClass} />
        </Field>
        <Field label="懇親会の参加費（1人あたり・円）">
          <input type="number" min={0} step={1} max={Number.MAX_SAFE_INTEGER} value={socialFee} onChange={e => setSocialFee(e.target.value)} className={`${inputClass} max-w-xs`} />
        </Field>
        <p className="text-sm text-slate-500">参加費は空欄なら未定、0円なら無料として表示します。</p>
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

      {error&&<p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
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
  const id = useId();
  const control = isValidElement<{ id?: string }>(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type);
  if (!control) return <fieldset>
    <legend className="block text-sm font-medium text-slate-700 mb-1.5">{label}{required && <span className="text-red-500 ml-1">*</span>}</legend>
    {children}
  </fieldset>;
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {cloneElement(children, { id })}
    </div>
  );
}

const inputClass =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent transition-shadow';

const textareaClass =
  'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400 focus:border-transparent transition-shadow resize-y';
