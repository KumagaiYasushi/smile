import { registrationPageStore } from '@/lib/registration-page';
import { ParticipantSearchPanel } from '@/components/RegistrationForms';

export default async function ParticipantsPage() {
  const store = await registrationPageStore();
  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">参加者マスター</h1>
    <p className="text-slate-600 text-sm">イベントをまたいだ申込と連絡先の履歴を確認できます。新規登録は各イベントの「申込情報」から行います。</p>
    <ParticipantSearchPanel initial={store.search()} />
  </div>;
}
