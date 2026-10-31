'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Seminar, CHECKLIST_ITEMS } from '@/types/seminar';

function ChecklistProgress({ seminar }: { seminar: Seminar }) {
  const completed = CHECKLIST_ITEMS.filter((item) => seminar[item.key]).length;
  const total = CHECKLIST_ITEMS.length;
  const pct = Math.round((completed / total) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-500 mb-1">
        <span>進捗</span>
        <span>{completed}/{total}</span>
      </div>
      <div className="w-full bg-slate-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all ${pct === 100 ? 'bg-green-500' : 'bg-sky-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function formatDate(dateStr: string) {
  return dateStr.replace(/-/g, '/');
}

export default function HomePage() {
  const [seminars, setSeminars] = useState<Seminar[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/seminars')
      .then((r) => r.json())
      .then((data) => {
        setSeminars(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">読み込み中...</div>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">セミナー一覧</h1>
        <p className="text-slate-500 text-sm mt-1">
          {seminars.length === 0 ? 'セミナーはまだ登録されていません' : `全 ${seminars.length} 件`}
        </p>
      </div>

      {seminars.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-16 text-center">
          <div className="text-5xl mb-4">📋</div>
          <h2 className="text-xl font-bold text-slate-700 mb-2">セミナーを登録しましょう</h2>
          <p className="text-slate-500 text-sm mb-6">右上の「＋ 新規セミナー」ボタンから登録できます</p>
          <Link
            href="/seminars/new"
            className="inline-block bg-sky-700 text-white px-6 py-3 rounded-lg font-bold hover:bg-sky-600 transition-colors"
          >
            ＋ 新規セミナーを作成
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {seminars.map((seminar) => (
            <Link
              key={seminar.id}
              href={`/seminars/${seminar.id}`}
              className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md hover:border-sky-300 transition-all block"
            >
              <div className="flex items-start justify-between mb-3">
                <h2 className="font-bold text-slate-800 text-base leading-tight flex-1 mr-2">
                  {seminar.name}
                </h2>
                {seminar.dates.length > 0 && (
                  <span className="text-xs bg-sky-50 text-sky-700 px-2 py-1 rounded-full whitespace-nowrap flex-shrink-0">
                    {seminar.dates.length}日程
                  </span>
                )}
              </div>

              {seminar.dates.length > 0 && (
                <div className="text-sm text-slate-600 mb-3 space-y-0.5">
                  {seminar.dates.slice(0, 2).map((d, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <span className="text-slate-400">📅</span>
                      <span>{formatDate(d)}</span>
                    </div>
                  ))}
                  {seminar.dates.length > 2 && (
                    <div className="text-slate-400 text-xs">他 {seminar.dates.length - 2} 日程...</div>
                  )}
                </div>
              )}

              {seminar.lecturer_name && (
                <div className="text-sm text-slate-600 mb-3 flex items-center gap-1">
                  <span className="text-slate-400">👨‍⚕️</span>
                  <span>{seminar.lecturer_name}</span>
                </div>
              )}

              {seminar.venue && (
                <div className="text-sm text-slate-600 mb-3 flex items-center gap-1">
                  <span className="text-slate-400">📍</span>
                  <span className="truncate">{seminar.venue}</span>
                </div>
              )}

              <div className="mt-4 pt-4 border-t border-slate-100">
                <ChecklistProgress seminar={seminar} />
              </div>

              <div className="mt-3 flex flex-wrap gap-1">
                {CHECKLIST_ITEMS.map((item) => (
                  <span
                    key={item.key}
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      seminar[item.key]
                        ? 'bg-green-100 text-green-700'
                        : 'bg-slate-100 text-slate-400'
                    }`}
                  >
                    {seminar[item.key] ? '✓' : '○'} {item.label}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
