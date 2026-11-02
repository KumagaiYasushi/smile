// Messages in this error class contain fixed guidance, never setting values.
export class HostedVerificationConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'HostedVerificationConfigError'; }
}

export function hostedVerificationSettings(env: Record<string, string | undefined>) {
  const email = env.SMILE_VERIFICATION_EMAIL?.trim().toLowerCase();
  const password = env.SMILE_VERIFICATION_PASSWORD;
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HostedVerificationConfigError('SMILE_VERIFICATION_EMAIL にログイン用メールアドレスを設定してください');
  if (!password || password.length < 12 || password.length > 128) throw new HostedVerificationConfigError('SMILE_VERIFICATION_PASSWORD に12〜128文字のパスワードを設定してください');
  const configuredOrigin = env.SMILE_VERIFICATION_ORIGIN?.trim() || env.RENDER_EXTERNAL_URL?.trim();
  let url: URL;
  try { url = new URL(configuredOrigin ?? ''); } catch { throw new HostedVerificationConfigError('SMILE_VERIFICATION_ORIGIN または RENDER_EXTERNAL_URL に公開先のHTTPS URLを設定してください'); }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new HostedVerificationConfigError('SMILE_VERIFICATION_ORIGIN または RENDER_EXTERNAL_URL はパスや認証情報を含まないHTTPS URLを設定してください');
  const origin = url.origin;
  const directory = env.SMILE_VERIFICATION_DATA_DIR?.trim();
  if (!directory) throw new HostedVerificationConfigError('検証専用の SMILE_VERIFICATION_DATA_DIR を設定してください');
  const runtime: Record<string, string | undefined> = { ...env, SMILE_VERIFICATION_MODE: '1', SMILE_VERIFICATION_ORIGIN: origin,
    SMILE_VERIFICATION_HOST: '0.0.0.0', SMILE_VERIFICATION_DATA_DIR: directory, NODE_ENV: 'production' };
  // Bootstrap credentials are only sent over the setup child's stdin.
  delete runtime.SMILE_VERIFICATION_PASSWORD;
  delete runtime.SMILE_VERIFICATION_EMAIL;
  return { email, password, runtime };
}
