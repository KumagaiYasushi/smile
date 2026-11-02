import assert from 'node:assert/strict';
import test from 'node:test';
import { emptySocialGathering, parseSocialGathering, mergeSocialGathering, formatSocialDateTime } from '../types/social-gathering.ts';

const gathering = { status: 'HELD', start_at: '2027-06-01T18:30', end_at: '2027-06-01T20:30', venue: '架空レストラン\n架空の住所', fee: 5000 };

test('social gatherings distinguish undecided, not held, planned, unknown fee and free admission', () => {
  assert.deepEqual(parseSocialGathering({ status: 'UNDECIDED' }), emptySocialGathering());
  assert.deepEqual(parseSocialGathering(gathering), gathering);
  for (const status of ['UNDECIDED', 'HELD', 'NOT_HELD']) {
    assert.deepEqual(parseSocialGathering({ ...gathering, status, fee: 0 }), { ...gathering, status, fee: 0 });
  }
  assert.equal(parseSocialGathering({ ...gathering, fee: null }).fee, null);
  assert.equal(formatSocialDateTime('2027-06-01T18:30'), '2027年06月01日 18:30（日本時間）');
  assert.equal(formatSocialDateTime(null), '未定');
});

test('partial changes preserve other gathering information and validate against existing start/end times', () => {
  const cancelled = mergeSocialGathering(gathering, { status: 'NOT_HELD' });
  assert.deepEqual(cancelled, { ...gathering, status: 'NOT_HELD' });
  assert.deepEqual(mergeSocialGathering(cancelled, { status: 'HELD' }), gathering);
  assert.deepEqual(mergeSocialGathering(gathering, { end_at: null, fee: null }), { ...gathering, end_at: null, fee: null });
  assert.throws(() => mergeSocialGathering(gathering, { start_at: '2027-06-02T18:30' }), { status: 400 });
  for (const invalid of [null, [], false, 'HELD']) assert.throws(() => mergeSocialGathering(gathering, invalid), { status: 400 });
});

test('malformed dates, reversed ranges, invalid prices and unknown fields are rejected', () => {
  const invalid = [null, [], {}, { ...gathering, status: 'toString' }, { ...gathering, venue: null },
    { ...gathering, venue: 'a'.repeat(2001) }, { ...gathering, start_at: null },
    { ...gathering, start_at: '2027-02-30T18:30' }, { ...gathering, start_at: '2027-06-01T24:00' },
    { ...gathering, start_at: '0000-06-01T18:30' }, { ...gathering, start_at: '2027-06-01T18:30Z' },
    { ...gathering, start_at: '2027-06-01' }, { ...gathering, end_at: '2027-06-01T18:29' },
    ...[-1, 1.5, '5000', true, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map(fee => ({ ...gathering, fee })),
    { ...gathering, actor_id: 1 }];
  for (const value of invalid) assert.throws(() => parseSocialGathering(value), { status: 400 });
  assert.equal(parseSocialGathering({ ...gathering, start_at: '2028-02-29T23:30', end_at: '2028-03-01T01:00' }).end_at, '2028-03-01T01:00');
});
