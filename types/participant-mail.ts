import {TaskError} from './task.ts';
import {parseTaskMail} from './task-message.ts';
import type {Participant} from './participant.ts';
export type ParticipantMailSettings={enabled:boolean;bank_id:1|2;consultation_url:string;homework:string};
export type BankAccount={id:1|2;name:string;details:string};
export const emptyParticipantMail=():ParticipantMailSettings=>({enabled:false,bank_id:1,consultation_url:'',homework:''});
export const PARTICIPANT_MAIL_LABELS={QUEUED:'送信待ち',BLOCKED:'設定・宛先の確認が必要',SENDING:'送信処理中',UNKNOWN:'送信結果の確認待ち',SENT:'送信済み',CANCELLED:'送信対象外'} as const;
export type MailKind='APPLICATION'|'PAYMENT';
export function parseParticipantMailSettings(value:unknown,basic:boolean):ParticipantMailSettings {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TaskError('自動メール設定が不正です');const p=value as Record<string,unknown>;
  if(Object.keys(p).some(k=>!['enabled','bank_id','consultation_url','homework'].includes(k))||typeof p.enabled!=='boolean'||![1,2].includes(p.bank_id as number)||typeof p.consultation_url!=='string'||p.consultation_url.length>2000||typeof p.homework!=='string'||p.homework.length>10000)throw new TaskError('自動メール設定を確認してください');
  if(p.consultation_url){let url:URL;try{url=new URL(p.consultation_url);}catch{throw new TaskError('臨床相談フォームはHTTPSのURLで入力してください');}if(url.protocol!=='https:'||url.username||url.password)throw new TaskError('臨床相談フォームはHTTPSのURLで入力してください');}
  if(!basic&&p.homework.trim())throw new TaskError('課題はベーシックコースにのみ設定できます');
  return {enabled:p.enabled,bank_id:p.bank_id as 1|2,consultation_url:p.consultation_url.trim(),homework:p.homework.trim()};
}
export function participantMailText(event:{name:string;dates:string[];event_type:string;fee_dental_hygienist:number;fee_dentist:number;fee_other:number},person:Pick<Participant,'name'|'email'|'role'|'paid_amount'>,settings:ParticipantMailSettings,bank:BankAccount,kind:MailKind){
  const payment=kind==='PAYMENT',amount=person.role==='dentist'?event.fee_dentist:person.role==='dental_hygienist'?event.fee_dental_hygienist:event.fee_other;
  const body=`${person.name} 様\n\n${payment?'ご入金を確認いたしました。お振り込みいただき、ありがとうございます。領収書をPDFで添付しておりますので、ご確認ください。':'このたびはお申し込みいただき、誠にありがとうございます。以下の内容でお申し込みを受け付けました。'}\n\n■ イベント名\n${event.name}\n\n■ 開催日\n${event.dates.length?event.dates.join('、'):'日程調整中'}\n\n${payment?`■ 入金確認額\n${person.paid_amount?.toLocaleString('ja-JP')}円\n\n`:`■ 参加費\n${amount.toLocaleString('ja-JP')}円\n\n■ お振込先\n${bank.name}\n${bank.details}\n\nお申し込みの氏名でお振り込みください。\n\n`}${!payment&&settings.consultation_url?`■ 日々の臨床のお悩み・困りごと\nこちらのGoogleフォームからお寄せください。\n${settings.consultation_url}\n\n`:''}${!payment&&event.event_type==='BASIC_COURSE'&&settings.homework?`■ 事前課題\n${settings.homework}\n\n`:''}ご不明な点は、このメールへご返信ください。\n当日お目にかかれますことを楽しみにしております。\n\n歯周基本治療研究会`;
  return parseTaskMail({to:person.email,subject:`【${event.name.slice(0,70)}】${payment?'入金確認と領収書のご案内':'お申し込みありがとうございます・受付確認と振込先のご案内'}`,body});
}
