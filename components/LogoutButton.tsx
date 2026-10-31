'use client';
import { useState } from 'react';

export default function LogoutButton() {
  const [error, setError] = useState(false);
  return <div>
    <button className="text-sm underline" onClick={async () => {
      try {
        const response = await fetch('/api/auth/logout', { method: 'POST' });
        if (!response.ok) throw new Error();
        window.location.assign('/login');
      } catch { setError(true); }
    }}>ログアウト</button>
    {error && <p role="alert" className="text-sm text-red-700">ログアウトできませんでした。再試行してください。</p>}
  </div>;
}
