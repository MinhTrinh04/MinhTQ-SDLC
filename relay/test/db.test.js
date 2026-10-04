'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../lib/db.js');
const { makeFakeDb } = require('./fake-db.js');

test('getDb without MONGODB_URI throws a generic error', async () => {
  db._setDb(null); delete process.env.MONGODB_URI;
  await assert.rejects(() => db.getDb(), /storage/);
});
test('_setDb injects a fake that getDb returns', async () => {
  const f = makeFakeDb(); db._setDb(f);
  assert.equal(await db.getDb(), f);
  db._setDb(null);
});
test('ensureIndexes is idempotent and makes keyHash unique', async () => {
  const f = makeFakeDb();
  await db.ensureIndexes(f); await db.ensureIndexes(f);
  assert.deepEqual(f.collection('machines').indexes, ['keyHash']);
});

test('a failed connect is generic, does not leak the URI, and is not retried immediately', { timeout: 30000 }, async () => {
  db._setDb(null);
  process.env.MONGODB_URI = 'mongodb://user:SECRET-DB-PASS@127.0.0.1:1/x';
  try {
    await assert.rejects(() => db.getDb(), (e) => {
      assert.equal(e.message, 'storage unavailable');
      assert.ok(!/SECRET-DB-PASS|127\.0\.0\.1/.test(e.message + String(e.stack)));
      return true;
    });
    const t = Date.now();
    await assert.rejects(() => db.getDb(), /storage unavailable/);
    assert.ok(Date.now() - t < 500, 'backoff: the second attempt must fail at once instead of waiting for server selection again');
  } finally { delete process.env.MONGODB_URI; db._setDb(null); }
});
