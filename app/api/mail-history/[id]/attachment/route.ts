import {NextRequest,NextResponse} from 'next/server';
import {requireMember,privateJson} from '@/lib/auth-server';
import {getDb} from '@/lib/db';
import {createMailHistoryStore} from '@/lib/mail-history';
import {renderReceiptPdf} from '@/lib/receipt-pdf';
import {parseId,TaskError} from '@/types/task';
export const runtime='nodejs';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){const denied=await requireMember(request);if(denied)return denied;try{const id=parseId((await params).id),store=createMailHistoryStore(getDb()),data=store.attachment(id);if(!data.pdf&&!data.receipt)throw new TaskError('添付ファイルの記録がありません',404);const bytes=data.pdf??await renderReceiptPdf(data.receipt!);if(!data.pdf)store.saveAttachment(id,bytes);return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="receipt.pdf"','Cache-Control':'no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});}catch(error){return privateJson({error:error instanceof TaskError?error.message:'添付ファイルを取得できませんでした'},error instanceof TaskError?error.status:500);}}
