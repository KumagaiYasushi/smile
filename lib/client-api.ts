export async function apiJson(path: string, options?: RequestInit) {
  const response = await fetch(path, { cache: 'no-store', ...options });
  if (response.status === 401) { window.location.assign('/login'); throw new Error('ログインが必要です'); }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '処理に失敗しました');
  return result;
}
