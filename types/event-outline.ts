export type EventOutline={
  event_id:number;organization:string;name:string;event_type:string;occurrence:string;content:string;
  schedule:{date:string;when:string;method:string;session?:string}[];venue:string|null;lecturers:{name:string;facility:string;theme?:string;date?:string}[];audience:string;
  fees:{label:string;amount:number|null}[];repeat_fees:{label:string;amount:number|null}[]|null;
  gatherings:{timing:string;start:string;end:string;venue:string;fee:number|null}[];
};
export const outlineAmount=(amount:number|null)=>amount===null?'未設定':`${amount.toLocaleString('ja-JP')}円`;
export function outlineFileName(name:string){
  const text=Array.from(name).filter(char=>{const point=char.codePointAt(0)!;return point<0xd800||point>0xdfff;}).join('').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g,'_').trim();
  return `${Array.from(text).slice(0,100).join('')||'イベント'}_開催要項.pdf`;
}
export function outlineSections(data:EventOutline):{title:string;text:string}[]{
  return [
    {title:'イベント種別・開催回数',text:`${data.event_type} ／ ${data.occurrence}`},
    {title:'開催日時・開催方法',text:data.schedule.length?data.schedule.map(row=>`${row.session?row.session+'\n':''}${row.when}\n${row.method}`).join('\n\n'):'日程未定'},
    ...(data.venue===null?[]:[{title:'会場',text:data.venue||'未設定'}]),
    {title:'講師',text:data.lecturers.length?data.lecturers.map(p=>`${p.date?p.date+' ／ ':''}${p.name}${p.facility?`（${p.facility}）`:''}${p.theme?`\nテーマ：${p.theme}`:''}`).join('\n'):'未設定'},
    {title:'主な参加対象',text:data.audience||'未設定'},
    {title:'開催内容',text:data.content||'未設定'},
    {title:data.repeat_fees?'参加費（複数回合計）':'参加費',text:data.fees.map(row=>`${row.label}：${outlineAmount(row.amount)}`).join('\n')},
    ...(data.repeat_fees?[{title:'単回金額（再受講用・1回あたり）',text:data.repeat_fees.map(row=>`${row.label}：${outlineAmount(row.amount)}`).join('\n')}]:[]),
    ...data.gatherings.map(p=>({title:`懇親会（${p.timing}）`,text:`開始：${p.start}\n終了：${p.end}\nお店・場所：${p.venue||'未設定'}\n参加費：${p.fee===null?'未設定':`${outlineAmount(p.fee)}／人`}`})),
  ];
}
