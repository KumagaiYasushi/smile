import PDFDocument from 'pdfkit';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {IssuedReceipt} from './receipts.ts';
let font:Buffer|undefined;
export function renderReceiptPdf(receipt:IssuedReceipt):Promise<Buffer>{
  font??=readFileSync(join(process.cwd(),'assets/fonts/NotoSansJP-Regular.ttf'));
  return new Promise((resolve,reject)=>{const doc=new PDFDocument({size:'A4',margin:48,info:{Title:'領収書',Author:'歯周基本治療研究会'}}),chunks:Buffer[]=[];doc.on('data',chunk=>chunks.push(Buffer.from(chunk)));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    try{doc.registerFont('Japanese',font!);doc.font('Japanese').fontSize(24).text('領収書',{align:'center'});doc.moveDown();doc.fontSize(10).text(`領収書番号：${receipt.receipt_number}`).text(`発行日：${receipt.issue_date}`);doc.moveDown();doc.fontSize(17).text(`${receipt.participant_name}${/(様|御中)$/.test(receipt.participant_name)?'':' 様'}`);doc.moveDown();doc.fontSize(24).text(`金額：￥${receipt.amount.toLocaleString('ja-JP')}`);doc.moveDown();doc.fontSize(11).text(`但し ${receipt.event_name} 参加費として`).text(`開催日：${receipt.event_dates.join('、')||'日程未定'}`).text('上記金額を領収いたしました。');doc.moveDown(2);doc.text('歯周基本治療研究会').text('https://stoptheperio.com');doc.end();}catch(error){doc.destroy();reject(error);}
  });
}
