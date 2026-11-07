import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostedVerificationSettings } from '../lib/hosted-verification.ts';

const password = randomBytes(24).toString('base64url');
const valid = { SMILE_VERIFICATION_EMAIL: ' Verifier@example.invalid ', SMILE_VERIFICATION_PASSWORD: password,
  RENDER_EXTERNAL_URL: 'https://test-service.example.invalid', SMILE_VERIFICATION_DATA_DIR: '/tmp/verification-data',
  HTTPS_PROXY: 'http://proxy.example.invalid:8080', NODE_EXTRA_CA_CERTS: '/tmp/test-ca.pem' };

test('hosted verification uses the platform HTTPS origin and strips bootstrap credentials while preserving proxy and CA settings', () => {
  const settings = hostedVerificationSettings(valid);
  assert.equal(settings.email, 'verifier@example.invalid');
  assert.equal(settings.password, password);
  assert.equal(settings.runtime.SMILE_VERIFICATION_PASSWORD, undefined);
  assert.equal(settings.runtime.SMILE_VERIFICATION_EMAIL, undefined);
  assert.equal(settings.runtime.SMILE_VERIFICATION_MODE, '1');
  assert.equal(settings.runtime.NODE_ENV, 'production');
  assert.equal(settings.runtime.SMILE_VERIFICATION_HOST, '0.0.0.0');
  assert.equal(settings.runtime.SMILE_VERIFICATION_ORIGIN, valid.RENDER_EXTERNAL_URL);
  assert.equal(settings.runtime.HTTPS_PROXY, valid.HTTPS_PROXY);
  assert.equal(settings.runtime.NODE_EXTRA_CA_CERTS, valid.NODE_EXTRA_CA_CERTS);
});

test('invalid hosted settings fail before setup and never print the supplied password', () => {
  for (const patch of [{ SMILE_VERIFICATION_EMAIL: '' }, { SMILE_VERIFICATION_PASSWORD: 'short' }, { SMILE_VERIFICATION_DATA_DIR: '' },
    { RENDER_EXTERNAL_URL: '' }, { RENDER_EXTERNAL_URL: 'http://example.invalid' },
    { RENDER_EXTERNAL_URL: 'https://example.invalid/path' }, { RENDER_EXTERNAL_URL: 'https://user:secret@example.invalid' }]) {
    assert.throws(() => hostedVerificationSettings({ ...valid, ...patch }));
  }
  const script = fileURLToPath(new URL('../scripts/start-hosted-verification.mjs', import.meta.url));
  const env = { ...process.env, SMILE_VERIFICATION_PASSWORD: password, SMILE_VERIFICATION_EMAIL: '' };
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(password));
  assert.match(result.stderr, /起動設定エラー: SMILE_VERIFICATION_EMAIL/);
});

test('blank optional origin falls back to Render; root trailing slash is canonicalized without allowing paths or credentials', () => {
  for (const patch of [{ SMILE_VERIFICATION_ORIGIN: '' }, { SMILE_VERIFICATION_ORIGIN: '   ' },
    { RENDER_EXTERNAL_URL: 'https://test-service.example.invalid/' }, { SMILE_VERIFICATION_ORIGIN: ' https://test-service.example.invalid/ ' }]) {
    assert.equal(hostedVerificationSettings({ ...valid, ...patch }).runtime.SMILE_VERIFICATION_ORIGIN, 'https://test-service.example.invalid');
  }
  for (const origin of ['https://example.invalid/path', 'https://example.invalid/?key=value', 'https://example.invalid/#fragment', 'https://user:secret@example.invalid/']) {
    assert.throws(() => hostedVerificationSettings({ ...valid, SMILE_VERIFICATION_ORIGIN: origin }));
  }
});

test('startup diagnostics identify every invalid setting without disclosing its value or the password', () => {
  const script = fileURLToPath(new URL('../scripts/start-hosted-verification.mjs', import.meta.url));
  const patches = [
    [{ SMILE_VERIFICATION_EMAIL: 'invalid-email-marker' }, 'SMILE_VERIFICATION_EMAIL', 'invalid-email-marker'],
    [{ SMILE_VERIFICATION_PASSWORD: 'short' }, 'SMILE_VERIFICATION_PASSWORD', 'short'],
    [{ SMILE_VERIFICATION_ORIGIN: 'https://user:private-secret@example.invalid' }, 'SMILE_VERIFICATION_ORIGIN', 'private-secret'],
    [{ SMILE_VERIFICATION_DATA_DIR: '' }, 'SMILE_VERIFICATION_DATA_DIR', password],
  ];
  const directory = mkdtempSync(join(tmpdir(), 'smile-invalid-settings-'));
  try { for (const [patch, key, secret] of patches) {
    const env = { ...process.env, ...valid, SMILE_VERIFICATION_DATA_DIR: directory, ...patch };
    // The CA/proxy examples above are only configuration preservation fixtures.
    delete env.NODE_EXTRA_CA_CERTS; delete env.HTTPS_PROXY;
    const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(key));
    assert.ok(!`${result.stdout}${result.stderr}`.includes(secret));
    assert.ok(!`${result.stdout}${result.stderr}`.includes(password));
    assert.equal(readdirSync(directory).length, 0);
  } } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('verification role is explicit, defaults to member, and is used only by setup',()=>{
 assert.equal(hostedVerificationSettings(valid).role,'member');
 const admin=hostedVerificationSettings({...valid,SMILE_VERIFICATION_ROLE:'admin'});assert.equal(admin.role,'admin');assert.equal(admin.runtime.SMILE_VERIFICATION_ROLE,undefined);
 assert.throws(()=>hostedVerificationSettings({...valid,SMILE_VERIFICATION_ROLE:'invalid-role-marker'}),/SMILE_VERIFICATION_ROLE/);
});
