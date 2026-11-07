export const MAIL_HISTORY_KINDS={TASK:'タスク依頼',APPLICATION:'申込受付',PAYMENT:'入金確認・領収書'} as const;
export type MailHistoryKind=keyof typeof MAIL_HISTORY_KINDS;
export type MailHistoryItem={id:number;event_id:number;event_name:string;kind:MailHistoryKind;recipient:string;recipient_name:string;sender:string;subject:string;sent_at:string;attachment_filename:string|null;event_exists:boolean};
export type MailHistoryPage={items:MailHistoryItem[];total:number;page:number;page_size:number;pending_count:number;events:{id:number;name:string}[]};
