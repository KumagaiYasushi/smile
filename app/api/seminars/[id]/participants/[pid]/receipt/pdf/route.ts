import {NextRequest,NextResponse} from 'next/server';
import {requireMember,privateJson} from '@/lib/auth-server';
import {getDb} from '@/lib/db';
import {createReceiptStore} from '@/lib/receipts';
import {renderReceiptPdf} from '@/lib/receipt-pdf';
import {parseId,TaskError} from '@/types/task';
export const runtime='nodejs';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string;pid:string}>}){const denied=await requireMember(request);if(denied)return denied;try{const p=await params,receipt=createReceiptStore(getDb()).get(parseId(p.id),parseId(p.pid)),bytes=await renderReceiptPdf(receipt);return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="receipt.pdf"','Cache-Control':'no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});}catch(error){return privateJson({error:error instanceof TaskError?error.message:'領収書PDFを作成できませんでした'},error instanceof TaskError?error.status:500);}}
