import PDFDocument from 'pdfkit';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {outlineSections} from '../types/event-outline.ts';
import type {EventOutline} from '../types/event-outline.ts';
let japaneseFont:Buffer|undefined;
export async function renderEventOutlinePdf(data:EventOutline):Promise<Buffer> {
  japaneseFont??=readFileSync(join(process.cwd(),'assets/fonts/NotoSansJP-Regular.ttf'));
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margins:{top:48,bottom:48,left:48,right:48},bufferPages:true,info:{Title:`${data.name} 開催要項`,Author:data.organization,Subject:'開催要項'}});
    const chunks:Buffer[]=[];
    doc.on('data',chunk=>chunks.push(Buffer.from(chunk)));doc.on('error',reject);doc.on('end',()=>resolve(Buffer.concat(chunks)));
    try{
      doc.registerFont('Japanese',japaneseFont!);doc.font('Japanese');
      doc.fontSize(10).fillColor('#075985').text(data.organization);doc.moveDown(0.8);
      doc.fontSize(22).fillColor('#111827').text('開催要項',{align:'center'});doc.moveDown(0.4);
      doc.fontSize(16).text(data.name,{align:'center'});doc.moveDown(1.2);
      for(const section of outlineSections(data)){
        if(doc.y>doc.page.height-doc.page.margins.bottom-75)doc.addPage();
        doc.fontSize(11).fillColor('#075985').text(section.title);doc.moveDown(0.25);
        doc.fontSize(10.5).fillColor('#111827').text(section.text,{lineGap:4});doc.moveDown(0.85);
      }
      const range=doc.bufferedPageRange();
      for(let page=0;page<range.count;page++){
        doc.switchToPage(range.start+page);
        const bottom=doc.page.margins.bottom;doc.page.margins.bottom=0;
        doc.fontSize(8).fillColor('#64748b').text(`${page+1} / ${range.count}`,48,doc.page.height-30,{width:doc.page.width-96,align:'center',lineBreak:false});
        doc.page.margins.bottom=bottom;
      }
      doc.end();
    }catch(error){doc.destroy();reject(error);}
  });
}
