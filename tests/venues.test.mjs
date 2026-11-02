import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createVenueStore, validateVenueLink } from '../lib/venues.ts';
import { emptyVenue, parseVenue, venueLocation } from '../types/venue.ts';

const input = { ...emptyVenue(), name: ' 架空会館 ', room: '第1会議室', address: '架空県架空市', phone: '000-000-0000',
  email: 'venue@example.invalid', website: 'https://venue.example.invalid', capacity: 50, reference_fee: 10000, fee_unit: '半日' };
function fixture() {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
  db.exec('CREATE TABLE auth_users(id INTEGER PRIMARY KEY,active INTEGER); INSERT INTO auth_users VALUES(1,1),(2,1),(3,0);');
  return { db, store: createVenueStore(db) };
}

test('venue directory supports reuse, literal search, filters, edits, archive and reactivation', () => {
  const { db, store } = fixture();
  try {
    let venue = store.create(input, 1);
    assert.equal(venue.name, '架空会館');
    assert.equal(venueLocation(venue), '架空会館 / 第1会議室 / 架空県架空市');
    const percent = store.create({ ...emptyVenue(), name: '100%会場_例' }, 1);
    createVenueStore(db);
    assert.equal(store.list('架空県').length, 1);
    assert.deepEqual(store.list('%').map(venue => venue.id), [percent.id]);
    assert.deepEqual(store.list('_').map(venue => venue.id), [percent.id]);
    assert.equal(store.list("' OR 1=1 --").length, 0);
    assert.equal(store.list('\\').length, 0);
    venue = store.update(venue.id, { reference_fee: 12000, version: 1 }, 2);
    assert.equal(venue.address, input.address);
    venue = store.update(venue.id, { active: false, version: venue.version }, 1);
    assert.equal(store.list().length, 1);
    assert.equal(store.list('', 'INACTIVE')[0].id, venue.id);
    assert.equal(store.list('', 'ALL').length, 2);
    assert.throws(() => validateVenueLink(db, venue.id), { status: 400 });
    assert.equal(validateVenueLink(db, venue.id, venue.id), venue.id);
    venue = store.update(venue.id, { active: true, version: venue.version }, 1);
    assert.equal(validateVenueLink(db, venue.id), venue.id);
    assert.equal(validateVenueLink(db, null), null);
  } finally { db.close(); }
});

test('venue validation rejects bad fields, prices, capacity, URLs and credentials; unknown and zero stay distinct', () => {
  assert.equal(parseVenue({ name: '会場' }).reference_fee, null);
  assert.equal(parseVenue({ name: '会場', capacity: 0, reference_fee: 0 }).reference_fee, 0);
  for (const body of [null, [], {}, { name: ' ' }, { ...input, name: 'x'.repeat(201) }, { ...input, actor_id: 2 },
    { ...input, email: 'invalid' }, { ...input, website: 'javascript:alert(1)' }, { ...input, website: 'https://user:secret@example.invalid' },
    { ...input, capacity: -1 }, { ...input, capacity: '50' }, { ...input, reference_fee: 1.5 }, { ...input, reference_fee: Infinity },
    { ...input, active: 1 }, { ...input, address: null }]) assert.throws(() => parseVenue(body), { status: 400 });
  const { db, store } = fixture();
  try {
    assert.throws(() => store.create(input, 3), { status: 403 });
    assert.throws(() => store.get(999), { status: 404 });
    assert.throws(() => store.list('', 'toString'), { status: 400 });
    assert.throws(() => store.list('x'.repeat(201)), { status: 400 });
    for (const id of [0, -1, '1', 999, {}, [], false]) assert.throws(() => validateVenueLink(db, id), { status: 400 });
    assert.equal(store.list().length, 0);
  } finally { db.close(); }
});

test('version conflicts do not overwrite changes; history avoids copying addresses, contacts and free text', () => {
  const { db, store } = fixture();
  try {
    const venue = store.create({ ...input, contact_person: 'Private name', notes: 'Private notes' }, 1);
    const updated = store.update(venue.id, { reference_fee: 20000, version: 1 }, 2);
    assert.throws(() => store.update(venue.id, { active: false, version: 1 }, 1), { status: 409 });
    assert.deepEqual(store.get(venue.id), updated);
    const history = store.history(venue.id);
    assert.equal(history[0].actor_id, 2);
    assert.equal(history[0].before.reference_fee, 10000);
    assert.equal(history[0].after.reference_fee, 20000);
    assert.deepEqual(history[0].changed_fields, ['reference_fee']);
    assert.ok(!JSON.stringify(history).includes('Private'));
    assert.ok(!JSON.stringify(history).includes(input.email));
    assert.equal(store.update(venue.id, { version: updated.version }, 1).version, updated.version);
    assert.equal(store.history(venue.id).length, 2);
  } finally { db.close(); }
});

test('venue creation, edits and archive roll back if audit recording fails', () => {
  const { db, store } = fixture();
  try {
    const venue = store.create(input, 1);
    db.exec("CREATE TRIGGER reject_venue_audit BEFORE INSERT ON venue_history BEGIN SELECT RAISE(ABORT,'audit unavailable'); END;");
    assert.throws(() => store.create({ name: '別会場' }, 1), /audit unavailable/);
    assert.throws(() => store.update(venue.id, { name: '変更', version: 1 }, 1), /audit unavailable/);
    assert.throws(() => store.update(venue.id, { active: false, version: 1 }, 1), /audit unavailable/);
    assert.deepEqual(store.list(), [venue]);
    assert.equal(store.history(venue.id).length, 1);
  } finally { db.close(); }
});
