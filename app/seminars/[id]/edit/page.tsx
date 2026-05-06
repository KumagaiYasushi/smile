'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import SeminarForm from '@/components/SeminarForm';
import { Seminar, SeminarInput } from '@/types/seminar';
import Link from 'next/link';

type Props = { params: Promise<{ id: string }> };

export default function EditSeminarPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [seminar, setSeminar] = useState<Seminar | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/seminars/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setSeminar(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const handleSubmit = async (data: SeminarInput) => {
    const res = await fetch(`/api/seminars/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('保存失敗');
    router.push(`/seminars/${id}`);
  };

  if (loading) return <div className="flex items-center justify-center h-64 text-slate-400">読み込み中...</div>;
  if (!seminar) return <div className="text-center py-16 text-slate-500">セミナーが見つかりません</div>;

  return (
    <div>
      <div className="mb-6">
        <div className="text-sm text-slate-500 mb-1">
          <Link href={`/seminars/${id}`} className="hover:text-sky-600">← 詳細に戻る</Link>
        </div>
        <h1 className="text-2xl font-bold text-slate-800">セミナー編集</h1>
        <p className="text-slate-500 text-sm mt-1">{seminar.name}</p>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8">
        <SeminarForm initial={seminar} onSubmit={handleSubmit} submitLabel="変更を保存" />
      </div>
    </div>
  );
}
