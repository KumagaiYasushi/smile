'use client';
import {SOCIAL_ATTENDANCE_ROLES,socialAttendanceCandidates} from '@/types/social-attendance';
import type {SocialAttendee} from '@/types/social-attendance';
import type {SocietyMember} from '@/types/society-member';
import type {ExternalSelection} from '@/types/external-lecturer';
import {MEETING_RESPONSE_LABELS} from '@/types/meeting';
import {rosterColor} from '@/types/staff-roster';
const input='mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-sm';
export default function SocialAttendanceFields({planId,value,members,external,onChange}:{planId:string;value:SocialAttendee[];members:SocietyMember[];external:ExternalSelection;onChange:(value:SocialAttendee[])=>void}) {
  const people=socialAttendanceCandidates(value,members,external);
  const update=(key:string,patch:Partial<SocialAttendee>)=>onChange(people.map(p=>p.key===key?{...p,...patch}:p));
  return <section aria-label="懇親会の出欠登録" className="space-y-4 border-t border-slate-200 pt-4">
    <h4 className="font-bold">懇親会の出欠登録</h4>
    <p className="text-xs text-slate-600">各懇親会の出欠を個別に登録します。出席は緑、欠席はグレー、未選択は黒で表示します。当日の出欠・打ち合わせの回答とは別に保存します。</p>
    <p className="text-sm">出席 {people.filter(p=>p.response==='ATTENDING').length}名 ／ 欠席 {people.filter(p=>p.response==='ABSENT').length}名 ／ 未選択 {people.filter(p=>p.response===null).length}名</p>
    {Object.entries(SOCIAL_ATTENDANCE_ROLES).map(([role,label])=><div key={role} className="space-y-2"><h5 className="font-bold">{label}</h5>
      <ul className="grid gap-2 lg:grid-cols-2">{people.filter(p=>p.role===role).map((person,index)=><li key={person.key} className={`min-w-0 rounded-xl border p-3 ${rosterColor(person.response??'UNANSWERED')}`}>
        {role==='OTHER'&&<label className="mb-2 block text-sm">その他の参加者 {index+1}の氏名<input aria-label={`その他の参加者 ${index+1}の氏名`} required pattern=".*\S.*" maxLength={200} value={person.name} onChange={e=>update(person.key,{name:e.target.value})} className={input}/></label>}
        <fieldset aria-label={`${role==='OTHER'?`その他の参加者 ${index+1}`:person.name}の懇親会出欠`} className="min-w-0"><legend className="break-words font-bold">{person.name||`その他の参加者 ${index+1}`}</legend>
          {person.facility&&<p className="mt-1 break-words text-xs">{person.facility}</p>}
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-2 text-sm">{Object.entries(MEETING_RESPONSE_LABELS).map(([response,label])=><label key={response} className="flex items-center gap-1 py-1"><input type="radio" name={`social-${planId}-${person.key}`} checked={person.response===response} onChange={()=>update(person.key,{response:response as SocialAttendee['response']})}/>{label}</label>)}</div>
        </fieldset>
        {role==='OTHER'&&<button type="button" onClick={()=>onChange(people.filter(p=>p.key!==person.key))} className="mt-2 text-sm text-red-700 underline">この参加者を削除</button>}
      </li>)}</ul>
      {!people.some(p=>p.role===role)&&<p className="text-xs text-slate-500">{role==='EXTERNAL_LECTURER'?'イベントの演者登録で外部講師を選択すると表示します。':'登録者はいません。'}</p>}
    </div>)}
    <button type="button" disabled={people.length>=1000} onClick={()=>onChange([...people,{key:`other-${crypto.randomUUID()}`,role:'OTHER',member_id:null,name:'',facility:'',response:null}])} className="rounded-lg border border-sky-300 bg-white px-4 py-2 text-sm text-sky-800">＋ その他の参加者を追加</button>
    <p className="text-xs text-slate-500">この後の参加人数は手入力で設定します。名簿の出席人数はこの欄で確認できます。</p>
  </section>;
}
