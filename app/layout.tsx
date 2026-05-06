import type { Metadata } from 'next';
import './globals.css';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '歯周基本治療研究会 セミナー管理',
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
                <div className="text-lg font-bold">セミナー管理システム</div>
              </div>
            </Link>
            <Link
              href="/seminars/new"
              className="bg-white text-sky-800 px-4 py-2 rounded-lg text-sm font-bold hover:bg-sky-50 transition-colors"
            >
              ＋ 新規セミナー
            </Link>
          </div>
        </header>
        <main className="max-w-6xl mx-auto px-4 py-8">
          {children}
        </main>
        <footer className="border-t border-slate-200 mt-16">
          <div className="max-w-6xl mx-auto px-4 py-4 text-center text-xs text-slate-400">
            歯周基本治療研究会 セミナー管理システム
          </div>
        </footer>
      </body>
    </html>
  );
}
