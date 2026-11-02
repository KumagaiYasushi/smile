import {NextRequest,NextResponse} from 'next/server';
import {requireMember,privateJson} from '@/lib/auth-server';
import {getSeminarById} from '@/lib/db';
import {buildEventOutline} from '@/lib/event-outline';
import {renderEventOutlinePdf} from '@/lib/event-outline-pdf';
import {outlineFileName} from '@/types/event-outline';
import {parseId,TaskError} from '@/types/task';
export const runtime='nodejs';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const denied=await requireMember(request);if(denied)return denied;
  try{
    const event=getSeminarById(parseId((await params).id));if(!event)throw new TaskError('イベントが見つかりません',404);
    const outline=buildEventOutline(event),bytes=await renderEventOutlinePdf(outline);
    const name=encodeURIComponent(outlineFileName(outline.name)).replace(/['()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);
    return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="event-outline.pdf"; filename*=UTF-8''${name}`,'Cache-Control':'no-store','Vary':'Cookie','X-Content-Type-Options':'nosniff'}});
  }catch(error){return privateJson({error:error instanceof TaskError?error.message:'開催要項PDFを作成できませんでした。もう一度お試しください。'},error instanceof TaskError?error.status:500);}
}
