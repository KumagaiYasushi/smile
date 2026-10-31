'use client';

import { useRouter } from 'next/navigation';
import SeminarForm from '@/components/SeminarForm';
import { SeminarInput } from '@/types/seminar';

export default function NewSeminarPage() {
  const router = useRouter();

  const handleSubmit = async (data: SeminarInput) => {
    const res = await fetch('/api/seminars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error('保存失敗');
    const created = await res.json();
    router.push(`/seminars/${created.id}`);
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">新規セミナー登録</h1>
        <p className="text-slate-500 text-sm mt-1">セミナーの基本情報を入力してください</p>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 p-6 md:p-8">
        <SeminarForm onSubmit={handleSubmit} submitLabel="登録する" />
      </div>
    </div>
  );
}
