import type {ReactNode} from 'react';

// Keep the original text; only validated web URLs become links.
export default function LinkedText({text,linksOnly=false}:{text:string;linksOnly?:boolean}) {
  const parts:ReactNode[]=[],links:ReactNode[]=[];let cursor=0;
  for(const match of text.matchAll(/https?:\/\/[^\s<>"'「」『』【】（）]+/giu)){
    let candidate=match[0].replace(/[.,!?;:、。，．！？：；]+$/u,'');
    while(candidate.endsWith(')')&&(candidate.match(/\)/g)?.length??0)>(candidate.match(/\(/g)?.length??0))candidate=candidate.slice(0,-1);
    let url:URL;try{url=new URL(candidate);}catch{continue;}
    if(!['http:','https:'].includes(url.protocol)||!url.hostname)continue;
    const link=<a key={match.index} href={url.href} target="_blank" rel="noopener noreferrer" title={candidate} className="break-all text-sky-800 underline underline-offset-2">{linksOnly?`お店・場所のURLを開く${links.length?`（${links.length+1}）`:''}`:candidate}</a>;
    parts.push(text.slice(cursor,match.index),link);links.push(link);cursor=match.index+candidate.length;
  }
  if(linksOnly)return links.length?<div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">{links}</div>:null;
  parts.push(text.slice(cursor));return <>{parts}</>;
}
