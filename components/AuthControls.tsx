'use client';
import {usePathname} from 'next/navigation';
import {useCallback,useEffect,useRef,useState} from 'react';
import Link from 'next/link';

export default function AuthControls({role,verification=false}:{role:'member'|'admin';verification?:boolean}){
  const pathname=usePathname(),root=useRef<HTMLElement>(null),trigger=useRef<HTMLButtonElement>(null);
  const [menu,setMenu]=useState({path:pathname,open:false}),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const open=menu.path===pathname&&menu.open;
  const measureMenu=useCallback(()=>{const node=root.current;if(!node)return;const rect=node.getBoundingClientRect(),viewport=window.visualViewport,height=viewport?viewport.height+viewport.offsetTop:window.innerHeight;const below=height-rect.bottom-16,above=rect.top-16,useAbove=below<180&&above>below;node.dataset.menuSide=useAbove?'above':'below';node.style.setProperty('--system-menu-space',`${Math.max(60,useAbove?above:below)}px`);},[]);
  useEffect(()=>{
    if(!open)return;measureMenu();window.addEventListener('resize',measureMenu);window.visualViewport?.addEventListener('resize',measureMenu);return()=>{window.removeEventListener('resize',measureMenu);window.visualViewport?.removeEventListener('resize',measureMenu);};
  },[open,measureMenu]);
  useEffect(()=>{
    function outside(e:PointerEvent){if(e.target instanceof Node&&!root.current?.contains(e.target))setMenu(value=>value.open?{...value,open:false}:value);}
    function escape(e:KeyboardEvent){if(e.key==='Escape'&&open){setMenu(value=>value.open?{...value,open:false}:value);trigger.current?.focus({preventScroll:true});}}
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);
  async function logout(){setBusy(true);try{const response=await fetch('/api/auth/logout',{method:'POST'});if(!response.ok)throw new Error();window.location.assign('/login');}catch{setError('ログアウトに失敗しました。もう一度お試しください。');setBusy(false);}}
  const links=[...(verification?[['/verification','検証ページ']]:[]),['/home','HOME'],['/my-page','メンバー個人ページ'],['/','イベント一覧'],['/dashboard','ダッシュボード'],['/seminars/new','＋ 新規イベント'],['/task-templates','タスクテンプレート'],['/venues','会場台帳'],['/society-members','講師・サポート名簿'],['/external-lecturers','外部講師リスト'],['/mail-history','メール送信履歴'],['/gmail','Gmail連携'],['/calendar','Googleカレンダー連携'],['/settings','システム設定'],...(role==='admin'?[['/admin/users','アカウント一覧']]:[])];
  return <aside ref={root} data-app-chrome aria-label="ナビゲーションエリア" className="group relative min-w-0 self-start rounded-2xl bg-sky-950 p-3 text-white shadow-sm lg:sticky lg:top-6 lg:max-h-[calc(100dvh-3rem)] lg:overflow-y-auto lg:overscroll-contain">
    <button ref={trigger} type="button" aria-label={open?'システムメニューを閉じる':'システムメニューを開く'} aria-expanded={open} aria-controls="system-menu-panel" onClick={()=>{if(!open)measureMenu();setMenu({path:pathname,open:!open});}} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-2 text-left lg:hidden"><span><span className="block font-bold">システムメニュー</span><span className="text-xs text-sky-200">ページの移動はこちら</span></span><span className="rounded-lg border border-sky-700 px-3 py-2 text-sm">{open?'閉じる':'開く ☰'}</span></button>
    <div className="hidden px-3 pb-4 pt-2 lg:block"><h2 className="font-bold">システムメニュー</h2><p className="mt-1 text-xs text-sky-200">{role==='admin'?'管理者':'運営メンバー'}</p></div>
    <div id="system-menu-panel" className={`${open?'block':'hidden'} absolute inset-x-0 top-[calc(100%_+_0.5rem)] z-50 max-h-[min(75dvh,var(--system-menu-space,75dvh))] group-data-[menu-side=above]:bottom-[calc(100%_+_0.5rem)] group-data-[menu-side=above]:top-auto overflow-y-auto overscroll-contain rounded-2xl border border-sky-800 bg-sky-950 p-3 shadow-xl lg:static lg:block lg:max-h-none lg:overflow-visible lg:rounded-none lg:border-0 lg:p-0 lg:shadow-none`}>
      <nav aria-label="システムメニュー" className="grid min-w-0 grid-cols-1 gap-1.5">{links.map(([href,label])=><Link key={href} href={href} aria-current={pathname===href?'page':undefined} onClick={()=>setMenu({path:pathname,open:false})} className={`flex min-h-12 min-w-0 items-center rounded-xl px-4 py-3 text-base [overflow-wrap:anywhere] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${href==='/seminars/new'?'border-2 border-orange-400 bg-orange-700 font-bold text-white shadow-sm hover:bg-orange-800':pathname===href?'bg-sky-100 font-bold text-sky-950':'text-sky-50 hover:bg-sky-900'}`}>{label}</Link>)}
        <button type="button" onClick={logout} disabled={busy} className="mt-2 min-h-12 rounded-xl border-t border-sky-800 px-4 py-3 text-left text-sm text-sky-200 hover:bg-sky-900">ログアウト</button>
      </nav>{error&&<p role="alert" className="mt-3 text-red-200">{error}</p>}
    </div>
  </aside>;
}
