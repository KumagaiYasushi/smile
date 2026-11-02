export function hostedVerificationSettings(env: Record<string, string | undefined>) {
  const email = env.SMILE_VERIFICATION_EMAIL?.trim().toLowerCase();
  const password = env.SMILE_VERIFICATION_PASSWORD;
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('SMILE_VERIFICATION_EMAIL にログイン用メールアドレスを設定してください');
  if (!password || password.length < 12 || password.length > 128) throw new Error('SMILE_VERIFICATION_PASSWORD に12〜128文字のパスワードを設定してください');
  const origin = env.SMILE_VERIFICATION_ORIGIN ?? env.RENDER_EXTERNAL_URL;
  let url: URL;
  try { url = new URL(origin ?? ''); } catch { throw new Error('公開先のHTTPS Originが設定されていません'); }
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error('公開先は末尾スラッシュなしのHTTPS Originを設定してください');
  if (!env.SMILE_VERIFICATION_DATA_DIR) throw new Error('検証専用の SMILE_VERIFICATION_DATA_DIR を設定してください');
  const runtime: Record<string, string | undefined> = { ...env, SMILE_VERIFICATION_MODE: '1', SMILE_VERIFICATION_ORIGIN: origin,
    SMILE_VERIFICATION_HOST: '0.0.0.0', NODE_ENV: 'production' };
  // Bootstrap credentials are only sent over the setup child's stdin.
  delete runtime.SMILE_VERIFICATION_PASSWORD;
  delete runtime.SMILE_VERIFICATION_EMAIL;
  return { email, password, runtime };
}
