'use client';
import {use,useEffect,useState,useCallback} from 'react';
import Link from 'next/link';
import TaskMailPanel from '@/components/TaskMailPanel';
import {apiJson} from '@/lib/client-api';
import type {EventTask} from '@/types/task';
import type {TaskMailPhase} from '@/types/task-message';
export default function EmailTemplatesPage({params}:{params:Promise<{id:string}>}){
  const {id}=use(params);
  const [tasks,setTasks]=useState<EventTask[]>([]),[mail,setMail]=useState<{task_id:number;phase:TaskMailPhase}[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
  const load=useCallback(()=>apiJson(`/api/seminars/${id}/tasks`).then(data=>{setTasks(data.tasks);setMail(data.mail);setError('');}).catch(e=>setError(e instanceof Error?e.message:'取得できませんでした')).finally(()=>setLoading(false)),[id]);
  useEffect(()=>{void load();},[load]);
  return <div className="space-y-5"><Link href={`/seminars/${id}`} className="text-sm text-sky-800 underline">イベントへ戻る</Link><h1 className="text-2xl font-bold">メール文面テンプレート</h1>
    <p className="text-sm text-slate-600">タスク内の依頼文を優先して文面を生成します。タスク画面と同じ文面を使用し、保存したメール文面は保持します。依頼内容・期限はタスクで編集してください。保存後にタスクを変更した場合は「タスクの依頼文から作り直す」で反映できます。</p>
    <Link href={`/seminars/${id}/tasks`} className="block text-sky-800 underline">タスク・依頼文を編集</Link>
    {loading&&<p>読み込み中…</p>}{error&&<p role="alert" className="text-red-700">{error}<button onClick={load} className="ml-3 underline">再取得</button></p>}
    {!loading&&!error&&!tasks.length&&<p>タスクを登録すると、依頼文からメール文面を作成できます。</p>}
    {tasks.map(task=><section key={task.id} className="rounded-xl border bg-white p-4"><h2 className="font-bold">{task.title}</h2>{task.description&&<p className="mt-2 whitespace-pre-wrap text-sm">{task.description}</p>}<TaskMailPanel eventId={id} taskId={task.id} phase={mail.find(m=>m.task_id===task.id)?.phase} onChange={load}/></section>)}
  </div>;
}
