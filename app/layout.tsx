import type { Metadata } from 'next';
import './globals.css';
import FormValidationFeedback from '@/components/FormValidationFeedback';
import Link from 'next/link';

export const metadata: Metadata = {
  title: '歯周基本治療研究会 セミナー管理',
  description: '歯周基本治療研究会のセミナー企画・運営管理システム',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-slate-50">
        <FormValidationFeedback/>
        <header data-app-chrome className="bg-sky-800 text-white shadow-md">
          <div className="max-w-[1440px] min-w-0 mx-auto px-3 sm:px-6 py-4 flex items-center justify-between">
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <div>
                <div className="text-xs text-sky-200 font-medium tracking-wider">歯周基本治療研究会</div>
                <div className="text-lg font-bold">セミナー管理システム</div>
              </div>
            </Link>
          </div>
        </header>
        <main data-app-main className="w-full min-w-0 max-w-[1440px] mx-auto px-3 py-5 sm:px-6 sm:py-6">
          {children}
        </main>
        <footer data-app-chrome className="border-t border-slate-200 mt-16">
          <div className="max-w-[1440px] min-w-0 mx-auto px-3 sm:px-6 py-4 text-center text-xs text-slate-400">
            歯周基本治療研究会 セミナー管理システム
          </div>
        </footer>
      </body>
    </html>
  );
}
