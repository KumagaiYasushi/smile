import {NextRequest,NextResponse} from 'next/server';
import {createCalendarGoogle} from '@/lib/calendar-google';
import {scheduleCalendarSync} from '@/lib/calendar-server';
import {getDb} from '@/lib/db';
import {gmailConfig} from '@/lib/gmail';
export async function GET(request:NextRequest){let ok=false;try{if(request.nextUrl.searchParams.has('error'))throw new Error('cancelled');await createCalendarGoogle(getDb()).finish(request.nextUrl.searchParams.get('state')??'',request.cookies.get('smile_calendar_state')?.value??'',request.nextUrl.searchParams.get('code')??'');getDb().exec('INSERT INTO calendar_dirty_events(seminar_id) SELECT id FROM seminars WHERE true ON CONFLICT(seminar_id) DO UPDATE SET version=version+1');scheduleCalendarSync();ok=true;}catch{/* Never include authorization codes or provider error bodies in the response. */}
 const origin=(()=>{try{return gmailConfig().origin;}catch{return request.nextUrl.origin;}})();const response=NextResponse.redirect(new URL(`/calendar?connection=${ok?'success':'failed'}`,origin));response.headers.set('Referrer-Policy','no-referrer');response.headers.set('Cache-Control','no-store');response.cookies.set('smile_calendar_state','',{httpOnly:true,secure:true,sameSite:'lax',path:'/api/calendar',maxAge:0});return response;
}
