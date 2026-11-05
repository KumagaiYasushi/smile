'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/client-api';
import { isStaffAttending, attendanceDateKeys, attendanceDateLabel, STAFF_ROLE_LABELS } from '@/types/staff-attendance';
import type { StaffPerson, StaffRole } from '@/types/staff-attendance';
import { ROSTER_RESPONSE_LABELS, rosterColor } from '@/types/staff-roster';
import type { RosterResponse, StaffRoster, StaffRosterRow } from '@/types/staff-roster';

type SaveResult = { person:StaffPerson; roster:StaffRoster };
export default function StaffRosterBoard({ eventId, roster, disabled, filter, onSaved, onBusyChange, onDraftChange, date:controlledDate, onDateChange }: {
  date?:string;onDateChange?:(date:string)=>void;
  eventId?:string; roster:StaffRoster; disabled:boolean; filter:StaffRole|'ALL'; onSaved?:(result:SaveResult)=>Promise<void>; onBusyChange?:(busy:boolean)=>void; onDraftChange?:(row:StaffRosterRow,date:string,response:RosterResponse)=>void;
}) {
  const dates = attendanceDateKeys(roster.dates);
  const [date,setDate] = useState(dates[0]);
  const selectedDate = dates.includes(controlledDate??date) ? controlledDate??date : dates[0];
  const [pending,setPending] = useState<number|null>(null);
  const [error,setError] = useState('');
  const [message,setMessage] = useState('');
  const visible = roster.rows.filter(row => filter === 'ALL' || row.role === filter);
  async function save(row:StaffRosterRow,response:RosterResponse) {
    if(onDraftChange){onDraftChange(row,selectedDate,response);return;}
    if(!eventId||!onSaved)return;
    onBusyChange?.(true); setPending(row.member_id); setError(''); setMessage('');
    try {
      const result:SaveResult = await apiJson(`/api/seminars/${eventId}/staff-attendance/roster`, {
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({member_id:row.member_id,member_version:row.member_version,version:row.version,date:selectedDate,response,schedule:roster.dates}),
      });
      await onSaved(result); setMessage(`${row.name}：${attendanceDateLabel(selectedDate)}の${ROSTER_RESPONSE_LABELS[response]}を保存しました`);
    } catch(error) { setError(error instanceof Error ? error.message : '出欠を保存できませんでした'); }
    finally { setPending(null); onBusyChange?.(false); }
  }
  return <section aria-label="研究会名簿から出欠登録" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <h2 className="text-lg font-bold text-black">研究会講師・サポートの出欠登録</h2>
    <p className="text-sm text-slate-600">{onDraftChange?'このイベントに参加できる方の出欠を選択してください。イベントの保存ボタンでまとめて保存します。':'このイベントに参加できる方の出欠を選択してください。選ぶと保存します。'}複数回のイベントは開催日を切り替えて登録します。</p>
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm"><span className="font-bold text-green-700">出席（午前・午後のみを含む）：緑</span><span className="text-slate-500">欠席：グレー</span><span className="text-black">未登録：黒</span></p>
    <label className="block max-w-sm text-sm font-medium">出欠を登録する開催日
      <select aria-label="出欠を登録する開催日" disabled={disabled||pending!==null} value={selectedDate} onChange={e=>{setDate(e.target.value);onDateChange?.(e.target.value);setError('');setMessage('');}} className="mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2">
        {dates.map(date=><option key={date} value={date}>{attendanceDateLabel(date)}</option>)}
      </select>
    </label>
    {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error} 表示は保存済みの状態を保持しています。必要に応じて「最新情報を取得」を押してください。</p>}
    {message&&<p aria-live="polite" className="text-sm text-green-800">{message}</p>}
    {(['SOCIETY_LECTURER','SOCIETY_SUPPORT'] as const).map(role=>{
      const rows = visible.filter(row=>row.role===role);
      if(!rows.length)return null;
      return <div key={role} className="space-y-3"><h3 className="font-bold text-black">{STAFF_ROLE_LABELS[role]}</h3>
        <ul className="grid gap-3 lg:grid-cols-2">{rows.map(row=>{
          const response = row.responses[selectedDate] ?? 'UNANSWERED';
          return <li key={row.member_id} data-member-id={row.member_id} data-response={response} className={`min-w-0 rounded-xl border p-4 ${rosterColor(response)}`}>
            <fieldset disabled={disabled||pending!==null} aria-label={`${row.name}の出欠`} className="min-w-0">
              <legend className="mb-3 break-words font-bold">{row.name}</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">{Object.entries(ROSTER_RESPONSE_LABELS).map(([value,label])=><label key={value} className="flex cursor-pointer items-center gap-2 py-1">
                <input type="radio" name={`attendance-${eventId??'new'}-${row.member_id}-${selectedDate}`} value={value} checked={response===value} onChange={()=>save(row,value as RosterResponse)} className={`h-4 w-4 ${isStaffAttending(response)?'accent-green-700':response==='ABSENT'?'accent-slate-500':'accent-black'}`}/>{label}
              </label>)}</div>
            </fieldset>
            <p className="mt-2 text-xs">{pending===row.member_id?'保存中…':response==='TENTATIVE'?'調整中（未確定）':ROSTER_RESPONSE_LABELS[response]}{!row.active&&'・名簿は利用停止中'}</p>
            {row.directory_name!==row.name&&<p className="mt-1 break-words text-xs">現在の名簿：{row.directory_name}（このイベントでは登録時の氏名を保持）</p>}
          </li>;
        })}</ul>
      </div>;
    })}
    {visible.length===0&&<p className="text-sm text-slate-500">この区分の研究会メンバーはいません。</p>}
    <Link href="/society-members" className="inline-block text-sm text-sky-800 underline">研究会講師・サポート名簿を編集</Link>
  </section>;
}
