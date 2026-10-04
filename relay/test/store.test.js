'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const db = require('../lib/db.js');
const store = require('../lib/store.js');
const { makeFakeDb } = require('./fake-db.js');

const hash = (k) => crypto.createHash('sha256').update(k).digest('hex');
const KEY_A = 'a'.repeat(32), KEY_B = 'b'.repeat(40);
let fake;
async function setup(seed = {}) {
  fake = makeFakeDb(seed);
  db._setDb(fake);
  await db.ensureIndexes(fake);
  store._resetCache(); store._setClock(null);
  fake.state.calls.length = 0;
}
const machine = (name, key, over = {}) => ({ _id: name, keyHash: hash(key), createdAt: new Date(), revoked: false, ...over });
const finds = (name) => fake.state.calls.filter((c) => c === name).length;

test('findMachineByKeyHash: active, unknown, revoked, malformed', async () => {
  await setup({ machines: [machine('laptop', KEY_A), machine('old', KEY_B, { revoked: true })] });
  assert.equal(await store.findMachineByKeyHash(hash(KEY_A)), 'laptop');
  assert.equal(await store.findMachineByKeyHash(hash('z'.repeat(32))), null);
  assert.equal(await store.findMachineByKeyHash(hash(KEY_B)), null);
  fake.state.calls.length = 0;
  for (const bad of ['', 'abc', 'g'.repeat(64), 'A'.repeat(64), 5, null, undefined, {}, ['x']]) {
    assert.equal(await store.findMachineByKeyHash(bad), null);
  }
  assert.equal(fake.state.calls.length, 0, 'malformed input must not reach the DB');
});

test('machine cache: 30 s TTL with a fake clock', async () => {
  await setup({ machines: [machine('laptop', KEY_A)] });
  let t = 1e6; store._setClock(() => t);
  assert.equal(await store.findMachineByKeyHash(hash(KEY_A)), 'laptop');
  assert.equal(finds('machines.findOne'), 1);
  t = 1e6 + 29999;
  assert.equal(await store.findMachineByKeyHash(hash(KEY_A)), 'laptop');
  assert.equal(finds('machines.findOne'), 1, 'served from cache');
  fake.collection('machines').docs[0].revoked = true; // another instance revoked it
  assert.equal(await store.findMachineByKeyHash(hash(KEY_A)), 'laptop', 'still cached inside the TTL');
  t = 1e6 + 30001;
  assert.equal(await store.findMachineByKeyHash(hash(KEY_A)), null, 'revocation visible after the TTL');
});

test('unknown keys are never cached', async () => {
  await setup();
  assert.equal(await store.findMachineByKeyHash(hash(KEY_A)), null);
  assert.equal(store._cacheSizes().machines, 0);
  fake.collection('machines').docs.push(machine('late', KEY_A));
  assert.equal(await store.findMachineByKeyHash(hash(KEY_A)), 'late');
});

test('findTopic: exact, _default fallback, none, invalid ids, prototype names', async () => {
  await setup({ topics: [{ _id: 'projA', threadId: 11 }, { _id: '_default', threadId: 99 }, { _id: 'bad', threadId: 0 }] });
  assert.equal(await store.findTopic('projA'), 11);
  assert.equal(await store.findTopic('other'), 99);
  assert.equal(await store.findTopic('bad'), 99, 'an invalid project doc falls back to _default');
  assert.equal(await store.findTopic('constructor'), 99);
  assert.equal(await store.findTopic('__proto__'), 99);
  assert.equal(await store.findTopic('_default'), 99);
  await setup({ topics: [{ _id: 'projA', threadId: 11 }] });
  assert.equal(await store.findTopic('other'), null);
  assert.equal(await store.findTopic('constructor'), null);
  assert.equal(await store.findTopic('__proto__'), null);
  for (const id of [0, 2147483648, '11', 1.5, -3, null]) {
    await setup({ topics: [{ _id: 'p', threadId: id }] });
    assert.equal(await store.findTopic('p'), null, String(id));
  }
});

test('topic cache keeps misses for 30 s and is capped at 500 entries', async () => {
  await setup();
  let t = 1e6; store._setClock(() => t);
  assert.equal(await store.findTopic('p2'), null);
  fake.collection('topics').docs.push({ _id: 'p2', threadId: 7 });
  assert.equal(await store.findTopic('p2'), null, 'cached miss');
  t = 1e6 + 30001;
  assert.equal(await store.findTopic('p2'), 7);
  for (let i = 0; i < 501; i++) {
    await store.findTopic('proj-' + i);
    assert.ok(store._cacheSizes().topics <= 500);
  }
});

test('writes invalidate the caches', async () => {
  await setup({ machines: [machine('laptop', KEY_A)], topics: [{ _id: 'p', threadId: 5 }] });
  await store.findMachineByKeyHash(hash(KEY_A)); await store.findTopic('p');
  assert.deepEqual(store._cacheSizes(), { machines: 1, topics: 1 });
  await store.setTopic('p', 6);
  assert.deepEqual(store._cacheSizes(), { machines: 0, topics: 0 });
  assert.equal(await store.findTopic('p'), 6, 'new data without moving the clock');
  await store.findMachineByKeyHash(hash(KEY_A));
  await store.revokeMachine('laptop');
  assert.deepEqual(store._cacheSizes(), { machines: 0, topics: 0 });
  assert.equal(await store.findMachineByKeyHash(hash(KEY_A)), null);
  await store.removeTopic('p');
  assert.equal(await store.findTopic('p'), null);
  assert.equal(await store.addMachine('n', hash(KEY_B)), true);
  assert.deepEqual(store._cacheSizes(), { machines: 0, topics: 0 });
});

test('addMachine: duplicate name, duplicate hash, other errors', async () => {
  await setup();
  assert.equal(await store.addMachine('desk', hash(KEY_A)), true);
  assert.equal(await store.addMachine('desk', hash(KEY_B)), false);
  assert.equal(await store.addMachine('other', hash(KEY_A)), false, 'same keyHash violates the unique index');
  fake.state.fail = true;
  await assert.rejects(() => store.addMachine('x', hash(KEY_B)));
});

test('revokeMachine: sets flags, false for unknown, idempotent', async () => {
  await setup({ machines: [machine('laptop', KEY_A)] });
  assert.equal(await store.revokeMachine('laptop'), true);
  const doc = fake.collection('machines').docs[0];
  assert.equal(doc.revoked, true);
  assert.ok(doc.revokedAt instanceof Date);
  assert.equal(await store.revokeMachine('laptop'), true);
  assert.equal(await store.revokeMachine('ghost'), false);
});

test('listMachines never exposes hashes and is sorted', async () => {
  await setup({ machines: [machine('zeta', KEY_A), machine('alpha', KEY_B, { revoked: true })] });
  const list = await store.listMachines();
  assert.deepEqual(list.map((m) => m.name), ['alpha', 'zeta']);
  assert.equal(list[0].revoked, true);
  for (const m of list) assert.ok(!('keyHash' in m));
  const text = JSON.stringify(list);
  assert.ok(!text.includes(hash(KEY_A)) && !text.includes(hash(KEY_B)));
});

test('setTopic upserts, removeTopic reports, listTopics sorts', async () => {
  await setup();
  await store.setTopic('b', 2); await store.setTopic('a', 1); await store.setTopic('a', 3);
  assert.equal(fake.collection('topics').docs.length, 2);
  assert.deepEqual(await store.listTopics(), [{ project: 'a', threadId: 3 }, { project: 'b', threadId: 2 }]);
  assert.equal(await store.removeTopic('a'), true);
  assert.equal(await store.removeTopic('a'), false);
});

test('type guards reject non-strings and out-of-range ids without touching the DB', async () => {
  await setup();
  await assert.rejects(() => store.findTopic({ $ne: null }), TypeError);
  await assert.rejects(() => store.addMachine(['a'], 'x'), TypeError);
  await assert.rejects(() => store.setTopic('p', '5'), TypeError);
  await assert.rejects(() => store.removeTopic({}), TypeError);
  assert.equal(fake.state.calls.length, 0);
});

test('listMachines asks the database to exclude keyHash (projection is really used)', async () => {
  await setup({ machines: [machine('zeta', KEY_A)] });
  await store.listMachines();
  assert.deepEqual(fake.state.lastFind.projection, { keyHash: 0 });
});

test('a revoke that lands during an in-flight lookup is not undone by the cache', async () => {
  await setup({ machines: [machine('laptop', KEY_A)] });
  const col = fake.collection('machines');
  const orig = col.findOne.bind(col);
  let release; const gate = new Promise((r) => { release = r; });
  col.findOne = async (f) => { const d = await orig(f); await gate; return d; }; // lookup read revoked:false, then stalls
  const pending = store.findMachineByKeyHash(hash(KEY_A));
  await store.revokeMachine('laptop');                                          // admin revokes meanwhile
  release();
  await pending;
  assert.equal(store._cacheSizes().machines, 0, 'the stale result must not be cached');
  col.findOne = orig;
  assert.equal(await store.findMachineByKeyHash(hash(KEY_A)), null);
});

test('a topic change during an in-flight topic lookup is not undone by the cache', async () => {
  await setup({ topics: [{ _id: 'p', threadId: 5 }] });
  const col = fake.collection('topics');
  const orig = col.findOne.bind(col);
  let release; const gate = new Promise((r) => { release = r; });
  col.findOne = async (f) => { const d = await orig(f); await gate; return d; };
  const pending = store.findTopic('p');
  await store.setTopic('p', 6);
  release();
  await pending;
  assert.equal(store._cacheSizes().topics, 0);
  col.findOne = orig;
  assert.equal(await store.findTopic('p'), 6);
});

test('a lookup without database permission serves only the cache', async () => {
  await setup({ machines: [machine('laptop', KEY_A)] });
  assert.equal(await store.findMachineByKeyHash(hash(KEY_A), false), null, 'cache miss, no DB lookup allowed');
  assert.equal(fake.state.calls.length, 0);
  assert.equal(await store.findMachineByKeyHash(hash(KEY_A)), 'laptop');
  fake.state.calls.length = 0;
  assert.equal(await store.findMachineByKeyHash(hash(KEY_A), false), 'laptop', 'cache hit still works');
  assert.equal(fake.state.calls.length, 0);
});
