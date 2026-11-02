import assert from 'node:assert/strict';
import test from 'node:test';
import {buildEventOutline} from '../lib/event-outline.ts';
import {outlineSections,outlineFileName} from '../types/event-outline.ts';
import {renderEventOutlinePdf} from '../lib/event-outline-pdf.ts';
import {STUDY_CALENDAR_ID,STUDY_CALENDAR_ICS_URL,studyCalendarUrl} from '../types/study-calendar.ts';
const event={id:1,name:'架空の歯周基本治療セミナー',event_type:'SEMINAR',occurrence_type:'MULTIPLE',content:'講義と実習',dates:['2027-06-01','2027-06-08'],event_times:{'2027-06-01':{start:'09:30',end:'16:30'}},delivery_method:'ONSITE',session_delivery_methods:{'2027-06-01':'ONLINE','2027-06-08':'ONLINE'},venue:'非公開の配信拠点',venue_fee:98765,external_lecturer:{status:'YES',name:'公開講師',facility:'公開施設'},lecturer_name:'研究会の主講師',lecturer_role:'SOCIETY_LECTURER',assistant_members:['非公開スタッフ'],target_participants:'歯科衛生士・歯科医師',fee_dental_hygienist:5000,fee_dentist:10000,fee_other:0,repeat_fees:{dental_hygienist:null,dentist:500,other:0},external_payment:{travel:12345,honorarium:54321},notes:'非公開メモ',social_gathering:{status:'HELD',start_at:'2027-06-01T18:00',end_at:null,venue:'懇親会のお店',fee:5000,timings:['ON_DAY'],gatherings:[{id:'sample',timing:'ON_DAY',start_at:'2027-06-01T18:00',end_at:null,venue:'懇親会のお店',fee:5000,budget:76543,participants:25}]}};
test('calendar uses the supplied public calendar only, with Japanese display and Japan timezone for both views',()=>{
  assert.equal(decodeURIComponent(new URL(STUDY_CALENDAR_ICS_URL).pathname.split('/')[3]),STUDY_CALENDAR_ID);
  for(const view of ['MONTH','AGENDA']){const url=new URL(studyCalendarUrl(view));assert.equal(url.origin,'https://calendar.google.com');assert.equal(url.pathname,'/calendar/embed');assert.equal(url.searchParams.get('src'),STUDY_CALENDAR_ID);assert.equal(url.searchParams.get('ctz'),'Asia/Tokyo');assert.equal(url.searchParams.get('hl'),'ja');assert.equal(url.searchParams.get('mode'),view);}
});
test('publication outline keeps dates/methods/lecturers/fees and excludes all operational planning and online venue details',()=>{
  const outline=buildEventOutline(event),text=JSON.stringify(outline);
  assert.equal(outline.venue,null);assert.equal(outline.schedule[0].session,`${event.name} 第1回`);assert.equal(outline.schedule[1].session,`${event.name} 第2回`);assert.match(outlineSections(outline).find(p=>p.title==='開催日時・開催方法').text,/第2回/);assert.match(outline.schedule[0].when,/09:30/);assert.equal(outline.schedule[1].method,'オンライン');assert.equal(outline.repeat_fees[1].amount,500);assert.equal(outline.fees[2].amount,0);
  assert.ok(text.includes('公開施設'));assert.ok(text.includes('懇親会のお店'));
  for(const marker of ['非公開','98765','12345','54321','76543','participants','budget','external_payment','assistant_members'])assert.ok(!text.includes(marker),marker);
  const mixed=buildEventOutline({...event,session_delivery_methods:{'2027-06-01':'ONSITE','2027-06-08':'ONLINE'},venue:'公開会場'});assert.equal(mixed.venue,'公開会場');
  const noGuest=buildEventOutline({...event,external_lecturer:{status:'NO',name:'保存済みだが非掲載',facility:''},lecturer_role:'EXTERNAL_LECTURER',lecturer_name:'保存済みだが非掲載',social_gathering:{...event.social_gathering,status:'NOT_HELD'}});assert.equal(noGuest.lecturers.length,0);assert.equal(noGuest.gatherings.length,0);
  const undated=outlineSections(buildEventOutline({...event,dates:[],occurrence_type:'SINGLE',event_type:'OTHER'}));assert.equal(undated.find(p=>p.title==='開催日時・開催方法').text,'日程未定');assert.ok(!undated.some(p=>p.title.includes('再受講')));
});
test('PDF filename removes control characters/path separators and supports Japanese and supplementary characters',()=>{
  const name=outlineFileName('講演会/研修\\案内\r\n資料😀');assert.ok(name.endsWith('_開催要項.pdf'));assert.ok(!/[\r\n/\\]/.test(name));assert.ok(name.includes('😀'));assert.doesNotThrow(()=>encodeURIComponent(outlineFileName('\ud800')));
});
test('Japanese A4 PDF exports are readable documents and paginate long event content',async()=>{
  const outline=buildEventOutline(event),bytes=await renderEventOutlinePdf(outline);
  assert.match(bytes.subarray(0,8).toString(),/^%PDF-/);assert.match(bytes.toString('latin1'),/\/MediaBox \[0 0 595\.28 841\.89\]/);
  const compact=await renderEventOutlinePdf({...outline,name:'開催案内',content:'短い説明',schedule:outline.schedule.slice(0,1),repeat_fees:null,gatherings:[]});
  assert.equal((compact.toString('latin1').match(/\/Type \/Page\b/g)??[]).length,1,'footer does not create a blank extra page');
  const long=await renderEventOutlinePdf({...outline,content:'歯周基本治療の講義と実習について説明します。\n'.repeat(180)});
  assert.ok((long.toString('latin1').match(/\/Type \/Page\b/g)??[]).length>1);assert.ok(long.subarray(-30).toString().includes('%%EOF'));
});
