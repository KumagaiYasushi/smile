'use client';
import {useCallback,useEffect,useLayoutEffect,useRef} from 'react';
import type {FormEvent,MouseEvent} from 'react';

// Preserve the current viewport for edits and disclosure controls. Explicit navigation
// and submit validation still move to their requested destination.
export function useStableEditorScroll(){
  const position=useRef<{x:number;y:number}|null>(null),frame=useRef<number|null>(null);
  const restore=useCallback(()=>{const saved=position.current;position.current=null;if(saved&&(window.scrollX!==saved.x||window.scrollY!==saved.y))window.scrollTo({left:saved.x,top:saved.y,behavior:'instant'});},[]);
  useLayoutEffect(()=>{restore();});
  useEffect(()=>()=>{if(frame.current!==null)cancelAnimationFrame(frame.current);position.current=null;},[]);
  function cancel(){position.current=null;if(frame.current!==null){cancelAnimationFrame(frame.current);frame.current=null;}}
  function remember(){position.current={x:window.scrollX,y:window.scrollY};if(frame.current!==null)cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(()=>{frame.current=null;restore();});}
  return {
    onSubmitCapture(){cancel();},
    onChangeCapture(event:FormEvent<HTMLFormElement>){const target=event.target;if(!(target instanceof HTMLElement)||target.closest('dialog'))return;if(target.getAttribute('aria-label')==='入力する項目へ移動'){cancel();return;}remember();},
    onClickCapture(event:MouseEvent<HTMLFormElement>){const target=event.target;if(!(target instanceof Element)||target.closest('dialog'))return;const control=target.closest('summary,button');if(!control)return;if(control instanceof HTMLButtonElement&&(control.type==='submit'||control.getAttribute('aria-label')?.includes('ダイアル'))){cancel();return;}remember();},
  };
}
