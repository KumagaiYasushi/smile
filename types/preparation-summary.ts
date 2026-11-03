import {todayInTokyo,isTaskOverdue} from './task.ts';
import type {EventTask} from './task.ts';
import type {TaskMailPhase} from './task-message.ts';
export function preparationSummary(tasks:EventTask[],mail:{task_id:number;phase:TaskMailPhase}[],now=new Date()){
  const today=todayInTokyo(now);if(!tasks.length)return {date:today,text:'準備タスクは未登録です。開催内容に応じた作業・期限・担当者を追加して、準備状況を確認してください。'};const done=tasks.filter(p=>p.status==='DONE').length,overdue=tasks.filter(p=>isTaskOverdue(p,today));const active=tasks.filter(p=>p.status!=='DONE').sort((a,b)=>(a.due_date??'9999').localeCompare(b.due_date??'9999')||Number(b.important)-Number(a.important)||a.id-b.id);
  const sent=mail.filter(p=>p.phase==='SENT').length,received=mail.filter(p=>p.phase==='RECEIVED').length,unknown=mail.filter(p=>p.phase==='SENDING'||p.phase==='UNKNOWN').length;
  const next=active[0],message=`準備は全${tasks.length}件中${done}件が完了しています。${overdue.length?`期限超過が${overdue.length}件あるため、優先して確認してください。`:'期限超過はありません。'}メールは返信待ち${sent}件、受信済み${received}件${unknown?`、送信結果の確認待ち${unknown}件`:''}です。${next?`次は「${next.title.slice(0,35)}${next.title.length>35?'…':''}」${next.due_date?`（期限${next.due_date}）`:'の期限・担当'}を確認してください。`:'登録済みのタスクは完了しています。最終の開催内容をご確認ください。'}${received?'受信済み資料の内容・不足分も確認してください。':''}`;
  return {date:today,text:message};
}
