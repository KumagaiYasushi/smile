'use client';

import { useEffect, useState, use } from 'react';
import { useRouter } from 'next/navigation';
import SeminarForm from '@/components/SeminarForm';
import { Seminar, SeminarSubmission } from '@/types/seminar';
import Link from 'next/link';
import {apiJson} from '@/lib/client-api';

type Props = { params: Promise<{ id: string }> };

export default function EditSeminarPage({ params }: Props) {
  const { id } = use(params);
  const router = useRouter();
  const [seminar, setSeminar] = useState<Seminar | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,setError]=useState('');

  useEffect(() => {
    const controller=new AbortController();
    apiJson(`/api/seminars/${id}`,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted){setSeminar(data);setLoading(false);}
    }).catch(error=>{if(!controller.signal.aborted){setSeminar(null);setError(error.message);setLoading(false);}});
    return ()=>controller.abort();
  }, [id]);

  const handleSubmit = async (data: SeminarSubmission) => {
    await apiJson(`/api/seminars/${id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    router.push(`/seminars/${id}`);
  };

  if (loading || (seminar && seminar.id!==Number(id))) return <div className="flex items-center justify-center h-64 text-slate-400">読み込み中...</div>;
  if (!seminar) return <div className="text-center py-16 text-slate-500">{error||'セミナーが見つかりません'}</div>;

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
        <SeminarForm key={seminar.id} initial={seminar} onSubmit={handleSubmit} submitLabel="変更を保存" />
      </div>
    </div>
  );
}
