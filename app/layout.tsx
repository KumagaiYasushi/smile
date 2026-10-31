import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '歯周基本治療研究会 企画運営管理',
  description: '歯周基本治療研究会のセミナー企画・運営管理システム',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-slate-50">
        <header className="bg-sky-800 text-white shadow-md">
          <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <div>
                <div className="text-xs text-sky-200 font-medium tracking-wider">歯周基本治療研究会</div>
                <div className="text-lg font-bold">企画運営管理システム</div>
              </div>
            </Link>
          </div>
        </header>
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 text-center text-sm px-4 py-2">開発検証環境 · 架空データ専用 · 外部連携なし</div>
        <main className="max-w-6xl mx-auto px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-slate-200 mt-16">
          <div className="max-w-6xl mx-auto px-4 py-4 text-center text-xs text-slate-400">
            歯周基本治療研究会 企画運営管理システム
          </div>
        </footer>
      </body>
    </html>
  );
}
