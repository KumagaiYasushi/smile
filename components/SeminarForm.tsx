'use client';

import {useStableEditorScroll} from '@/components/useStableEditorScroll';
import SpeakerFields from '@/components/SpeakerFields';
import {eventSpeakers} from '@/types/speaker';
import { useState, useId, useRef, isValidElement, cloneElement } from 'react';
import {flagFieldError,clearFieldError} from '@/components/FormValidationFeedback';
import { useRouter } from 'next/navigation';
import { Seminar, SeminarSubmission, EventType, EVENT_TYPE_LABELS, DeliveryMethod, DELIVERY_METHOD_LABELS } from '@/types/seminar';
import Link from 'next/link';
import { emptySocialGathering, parseSocialGathering } from '@/types/social-gathering';
import type { SocialGathering } from '@/types/social-gathering';
import SocialGatheringEditor from '@/components/SocialGatheringEditor';
import {AUDIENCE_LABELS,allAudienceRoles,audienceFromLegacy,audienceText,parseAudienceRoles} from '@/types/audience';
import type {AudienceRole} from '@/types/audience';
import {useEventRoles} from '@/components/useEventRoles';
import EventRoleFields from '@/components/EventRoleFields';
import MeetingFields from '@/components/MeetingFields';
import {useMeetingDraft} from '@/components/useMeetingDraft';
import VenuePicker from '@/components/VenuePicker';
import { emptyRepeatFees, parseRepeatFees,parseSessionMethods } from '@/types/event-options';
import type { SessionMethods } from '@/types/event-options';
import StaffRosterBoard from '@/components/StaffRosterBoard';
import RegistrationLunchFields from '@/components/RegistrationLunchFields';
import {useEventRegistration} from '@/components/useEventRegistration';
import type {ExternalSelection} from '@/types/external-lecturer';
import EventTimesEditor from '@/components/EventTimesEditor';
import { OCCURRENCE_LABELS, validateOccurrences, parseEventTimes } from '@/types/event-schedule';
import type { OccurrenceType, EventTimes } from '@/types/event-schedule';

type Props = {
  initial?: Partial<Seminar>;
  onSubmit: (data: SeminarSubmission) => Promise<void>;
  submitLabel: string;
};

export default function SeminarForm({ initial, onSubmit, submitLabel }: Props) {
  const [speakers,setSpeakers]=useState(()=>eventSpeakers(initial??{}));
  const stableScroll=useStableEditorScroll();
  const [roleDate,setRoleDate]=useState(initial?.dates?.[0]??'');
  const router = useRouter();
  const formRef=useRef<HTMLFormElement>(null);
  const registration=useEventRegistration(initial?.id);
  const meetings=useMeetingDraft(initial?.id);
  const roles=useEventRoles(initial?.id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState(initial?.name ?? '');
  const [eventType, setEventType] = useState<EventType>(initial?.event_type ?? 'SEMINAR');
  const deliveryMethod=initial?.delivery_method??undefined;
  const guest=speakers.find(p=>p.role==='EXTERNAL_LECTURER');
  const external:ExternalSelection=guest?{status:'YES',id:guest.id,name:guest.name,facility:guest.facility}:{status:'NO',id:null,name:'',facility:''};
  const [dates, setDates] = useState<string[]>(initial?.dates ?? ['']);
  const [occurrence, setOccurrence] = useState<OccurrenceType | ''>(initial?.occurrence_type ?? '');
  const [eventTimes, setEventTimes] = useState<EventTimes>(initial?.event_times ?? {});
  const [sessionMethods,setSessionMethods]=useState<SessionMethods>(initial ? {...Object.fromEntries((initial.dates??[]).filter(()=>initial.delivery_method).map(date=>[date,initial.delivery_method!])),...initial.session_delivery_methods} : {});
  const [repeatFees,setRepeatFees]=useState<Record<'dental_hygienist'|'dentist'|'other',string>>(()=>Object.fromEntries(Object.entries(initial?.repeat_fees??emptyRepeatFees()).map(([role,fee])=>[role,fee===null?'':String(fee)])) as Record<'dental_hygienist'|'dentist'|'other',string>);
  const lecturerRole=initial?.lecturer_role??'';
  const validDates = [...new Set(dates.filter(Boolean))];
  const allOnline = validDates.length ? validDates.every(date=>sessionMethods[date]==='ONLINE') : deliveryMethod==='ONLINE';
  const [content, setContent] = useState(initial?.content ?? '');
  const lecturerName=initial?.lecturer_name??'';
  const assistants=initial?.assistant_members??[];
  const [feeDH, setFeeDH] = useState(String(initial?.fee_dental_hygienist ?? ''));
  const [feeDr, setFeeDr] = useState(String(initial?.fee_dentist ?? ''));
  const [feeOther, setFeeOther] = useState(String(initial?.fee_other ?? ''));
  const [audienceRoles,setAudienceRoles]=useState<AudienceRole[]>(()=>initial?.audience_roles??audienceFromLegacy(initial?.target_participants??'')??allAudienceRoles());
  const [audienceChanged,setAudienceChanged]=useState(false);
  const keepLegacyAudience=!!initial?.target_participants&&!initial.audience_roles&&!audienceFromLegacy(initial.target_participants)&&!audienceChanged;
  const [venue, setVenue] = useState(initial?.venue ?? '');
  const [venueId, setVenueId] = useState<number | null>(initial?.venue_id ?? null);
  const [venueFee, setVenueFee] = useState(String(initial?.venue_fee ?? ''));
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [social, setSocial] = useState<SocialGathering>(() => initial?.social_gathering ?? emptySocialGathering());

  const updateDate = (i: number, value: string) => {
    const next = [...dates];
    next[i] = value;
    setDates(next);
  };
  const addDate = () => setDates([...dates, '']);
  const removeDate = (i: number) => setDates(dates.filter((_, idx) => idx !== i));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const form=e.currentTarget as HTMLFormElement;
    form.querySelectorAll<HTMLElement>('[data-custom-validation],fieldset[data-validation-error]').forEach(clearFieldError);
    if(!name.trim())flagFieldError(form.querySelector('[data-event-name]'),'セミナー名を入力してください。');
    const dateFields=[...form.querySelectorAll<HTMLInputElement>('[data-event-date]')];
    for(const field of dateFields)if(field.value&&dateFields.filter(p=>p.value===field.value).length>1)flagFieldError(field,'開催日が重複しています。別の日付を指定してください。');
    if(occurrence==='SINGLE'&&validDates.length>1)flagFieldError(form.querySelector('[data-occurrence]'),'単回では開催日を1日にしてください。複数日なら複数回を選択してください。');
    for(const [date,time] of Object.entries(eventTimes))if(validDates.includes(date)&&time.end&&time.start&&time.end<time.start)flagFieldError(form.querySelector(`[aria-label="${date}の終了時刻"]`),'終了時刻は開始時刻以降にしてください。');
    const audienceInvalid=!keepLegacyAudience&&audienceRoles.length===0;
    if(audienceInvalid)flagFieldError(form.querySelector('[data-audience]'),'主な参加対象を1つ以上選択してください。');
    if(!form.checkValidity()||audienceInvalid) {
      const invalid=form.querySelector<HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement>('input:invalid,select:invalid,textarea:invalid');
      const label=invalid?.getAttribute('aria-label')??invalid?.labels?.[0]?.textContent?.trim()??'入力項目';
      setError(`「${label}」を確認してください。${invalid?.validity.valueMissing?'入力または選択してください。':'入力形式・金額・時刻の範囲を確認してください。'}`);
      if(audienceInvalid&&!invalid)setError('主な参加対象を1つ以上選択してください。');
      invalid?.focus();invalid?.reportValidity();
      return;
    }
    if (!name.trim()) {
      setError('セミナー名は必須です');
      return;
    }
    setSaving(true);
    setError('');
    try {
      let gathering:SocialGathering;
      try{gathering=parseSocialGathering(social);}catch(error){flagFieldError(form.querySelector('[data-social]'),error instanceof Error?error.message:'懇親会の入力内容を確認してください。');throw error;}
      validateOccurrences(occurrence, validDates);
      const methods=parseSessionMethods(Object.fromEntries(validDates.map(date=>[date,sessionMethods[date]])),validDates);
      const repeat=parseRepeatFees(Object.fromEntries(Object.entries(repeatFees).map(([role,fee])=>[role,fee===''?null:Number(fee)])));
      const times = parseEventTimes(Object.fromEntries(Object.entries(eventTimes).filter(([date]) => validDates.includes(date))), validDates);
      const roleChanges=roles.payload(validDates);
      await onSubmit({
        registration: {...(registration.payload(validDates)??{schedule:[...validDates].sort(),attendance:[],lunch:[]}),meetings:meetings.payload(),...(roleChanges?{roles:roleChanges}: {})},
        speakers,
        event_type: eventType,
        delivery_method: methods[validDates[0]]??deliveryMethod,
        external_lecturer: external,
        occurrence_type: occurrence as OccurrenceType,
        session_delivery_methods: methods,
        repeat_fees: repeat,
        event_times: times,
        lecturer_role: lecturerRole==='EXTERNAL_LECTURER'?null:lecturerRole ? lecturerRole as 'EXTERNAL_LECTURER' | 'SOCIETY_LECTURER' : null,
        social_gathering: gathering,
        name: name.trim(),
        dates: dates.filter((d) => d.trim()),
        content,
        lecturer_name: lecturerRole==='EXTERNAL_LECTURER'?'':lecturerName,
        assistant_members: assistants.filter((a) => a.trim()),
        fee_dental_hygienist: Number(feeDH) || 0,
        fee_dentist: Number(feeDr) || 0,
        fee_other: Number(feeOther) || 0,
        ...(keepLegacyAudience?{target_participants:initial!.target_participants!}:{audience_roles:parseAudienceRoles(audienceRoles),target_participants:audienceText(audienceRoles)}),
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
    <form ref={formRef} data-stable-editor {...stableScroll} noValidate onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <Section title="基本情報">
        <div>
          <label htmlFor="event-type" className="block text-sm font-medium text-slate-700 mb-1.5">イベント種別</label>
          <select id="event-type" value={eventType} onChange={(e) => setEventType(e.target.value as EventType)} className={inputClass}>
            {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </div>
        <Field label="セミナー名" required>
          <input
            type="text"
            required
            data-event-name
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例：歯周基本治療セミナー 第1回"
            className={inputClass}
          />
        </Field>

        <Field label="開催回数" required>
          <select required data-occurrence value={occurrence} onChange={e => setOccurrence(e.target.value as OccurrenceType | '')} className={inputClass}>
            <option value="" disabled>選択してください</option>
            {Object.entries(OCCURRENCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <p className="text-xs text-slate-500">単回は1日、複数回は開催日を追加できます。日程未定でも開催回数は選択してください。</p>
        <Field label="日程">
          {initial?.id ? <div className="space-y-2 text-sm">
            <p>{validDates.join('、') || '日程未定'}</p>
            <Link href={`/seminars/${initial.id}/reschedule`} className="text-sky-800 underline">開催日・期限変更でプレビューする</Link>
          </div> : <div className="space-y-2">
            {dates.map((d, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input
                  data-event-date type="date"
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
        {validDates.length>0&&<fieldset className="space-y-3"><legend className="mb-2 font-medium">{occurrence==='MULTIPLE'?'各回の開催方法':'開催日の開催方法'}</legend>
          <p className="text-xs text-slate-500">開催日ごとに選択してください。日程未定の場合は、開催方法も後から設定できます。</p>
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

      <Section title="演者・テーマ"><SpeakerFields value={speakers} onChange={setSpeakers}/></Section>

      <Section title="イベント当日の出欠">
        {registration.loading&&<p className="text-sm text-slate-500">出欠・昼食を読み込み中…</p>}
        {registration.error&&<p role="alert" className="text-sm text-red-700">{registration.error}</p>}
        {!registration.loading&&<button type="button" disabled={saving} onClick={registration.reload} className="text-sm text-sky-800 underline">出欠・昼食を再取得</button>}
        {registration.roster&&<StaffRosterBoard date={roleDate} onDateChange={setRoleDate} eventId={initial?.id?String(initial.id):undefined} roster={{...registration.roster,dates:validDates}} disabled={saving||registration.loading||meetings.loading||roles.loading} filter="ALL" onDraftChange={(row,date,response)=>{registration.setResponse(row,date,response);if(registration.roster)roles.removeAbsentDayAssignees({...registration.roster,dates:validDates,rows:registration.roster.rows.map(p=>p.member_id===row.member_id?{...p,responses:{...p.responses,[date]:response}}:p)});}}/>}
      </Section>

      <Section title="役割担当">
        {roles.loading&&<p className="text-sm text-slate-500">担当・名簿を読み込み中…</p>}
        {roles.error&&<p role="alert" className="text-sm text-red-700">{roles.error}</p>}
        <button type="button" disabled={saving||roles.loading} onClick={roles.reload} className="text-sm text-sky-800 underline">担当・名簿を再取得</button>
        <EventRoleFields date={roleDate} onDateChange={setRoleDate} data={roles.data} attendance={registration.roster?{...registration.roster,dates:validDates}:undefined} disabled={saving||roles.loading||registration.loading||!!roles.error||!!registration.error} onToggle={roles.toggle}/>
      </Section>

      <Section title="打ち合わせ">
        {meetings.error&&<p role="alert" className="text-red-700">{meetings.error}</p>}
        {meetings.loading?<p>打ち合わせを読み込み中…</p>:<button type="button" onClick={meetings.reload} disabled={saving} className="text-sm text-sky-800 underline">打ち合わせを再取得</button>}
        <MeetingFields plans={meetings.plans} members={meetings.members} disabled={saving||meetings.loading||!!meetings.error} onAdd={meetings.add} onChange={meetings.update} onRemove={meetings.remove}/>
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
        <fieldset data-audience className="space-y-2"><legend className="text-sm font-medium">主な参加対象（複数選択可）</legend><div className="flex flex-wrap gap-4">{Object.entries(AUDIENCE_LABELS).map(([role,label])=><label key={role} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={audienceRoles.includes(role as AudienceRole)} onChange={e=>{setAudienceChanged(true);setAudienceRoles(current=>e.target.checked?[...current,role as AudienceRole]:current.filter(r=>r!==role));}}/>{label}</label>)}</div>
          {keepLegacyAudience&&<p className="text-xs text-slate-500">以前の参加対象：{initial?.target_participants}。選択を変更するまで以前の記録を保持します。</p>}
        </fieldset>
      </Section>

      <Section title="会場">
        {allOnline && <p className="text-sm text-slate-500">配信拠点などの内部記録に使用できます。オンライン開催の案内文には会場を掲載しません。</p>}
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
        <RegistrationLunchFields dates={validDates} plans={registration.lunch} disabled={saving||registration.loading||meetings.loading||roles.loading} onAdd={registration.addLunch} onChange={registration.updateLunch} onRemove={registration.removeLunch} getCounts={date=>registration.getLunchCounts(date,external)}/>
        {initial?.id && <Link href={`/seminars/${initial.id}/lunch`} className="inline-block text-sm text-sky-800 underline">昼食の手配を登録・確認する</Link>}
      </Section>

      <Section title="懇親会">
        <fieldset data-social aria-label="懇親会の入力"><SocialGatheringEditor value={social} onChange={setSocial} members={meetings.members} external={external} dates={validDates}/></fieldset>
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
      <p className="text-xs text-slate-500">保存すると、外部講師ありは登壇依頼・資料一括依頼・参加者確認メールの3件、なしは確認メール1件の基本タスクを設定します。期限・担当者は登録後に編集できます。</p>
      <div aria-label="イベントの保存操作" className="mt-8 flex flex-wrap items-center justify-between gap-6 border-t border-slate-200 bg-white p-4">
        <button
          type="button"
          disabled={saving}
          onClick={() => {if(confirm('入力中の変更を保存せずに戻りますか？'))router.back();}}
          className="px-5 py-2.5 rounded-lg border border-slate-300 text-slate-600 text-sm font-medium hover:bg-slate-50 transition-colors"
        >
          キャンセル
        </button>
        <button
          type="submit"
          disabled={saving||registration.loading||meetings.loading||roles.loading}
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
    <details data-form-section={title} open={title==='基本情報'} className="scroll-mt-36 rounded-xl border border-slate-200 bg-white p-4">
      <summary className="cursor-pointer select-none text-slate-700"><h2 className="inline text-base font-bold">{title==='演者・テーマ'?'演者登録（複数名登録可）':title}</h2><span className="ml-3 text-xs text-slate-500">開く・閉じる</span></summary>
      <div className="mt-4 space-y-4">{children}</div>
    </details>
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
