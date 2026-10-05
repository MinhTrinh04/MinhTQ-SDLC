'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const admin = require('../api/admin.js');
const notify = require('../api/notify.js');
const db = require('../lib/db.js'), store = require('../lib/store.js');
const { makeFakeDb } = require('./fake-db.js');

const sha = (k) => crypto.createHash('sha256').update(k).digest('hex');
const ADMIN_KEY = 'K'.repeat(40);
const DB_URI = 'mongodb://u:SECRET-DB-PASS@fake.invalid/x';
const DOT = String.fromCharCode(0xb7);
let fake;

function setupEnv(over = {}, seed = {}) {
  process.env.NOTIFY_ADMIN_KEY = ADMIN_KEY;
  process.env.MONGODB_URI = DB_URI;
  process.env.TELEGRAM_BOT_TOKEN = '123456:SECRET-BOT-TOKEN';
  process.env.TELEGRAM_CHAT_ID = '-100123';
  for (const [k, v] of Object.entries(over)) { if (v === null) delete process.env[k]; else process.env[k] = v; }
  fake = makeFakeDb(seed);
  db._setDb(fake); store._resetCache(); store._setClock(null);
  admin._resetRateLimit(); notify._resetRateLimit();
}
function mockRes() {
  const r = { statusCode: 0, headers: {}, body: '' };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.end = (b) => { r.body = b || ''; };
  return r;
}
async function call(body, opts = {}) {
  const { method = 'POST', key = ADMIN_KEY, ip } = opts;
  const req = { method, headers: { ...(key ? { authorization: 'Bearer ' + key } : {}), ...(ip ? { 'x-forwarded-for': ip } : {}) }, body };
  const res = mockRes();
  await admin(req, res);
  return res;
}
const json = (res) => JSON.parse(res.body);
function captureLogs() {
  const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.map(String).join(' '));
  return { lines, restore: () => { console.log = orig; } };
}

test('GET gives 405 with Allow: POST', async () => {
  setupEnv();
  const res = await call(undefined, { method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
});

test('missing, short or unconfigured values give an identical 500', async () => {
  const bodies = new Set();
  for (const over of [{ NOTIFY_ADMIN_KEY: null }, { NOTIFY_ADMIN_KEY: 'K'.repeat(31) }, { MONGODB_URI: null }]) {
    setupEnv(over);
    const res = await call({ action: 'machine-list' });
    assert.equal(res.statusCode, 500);
    bodies.add(res.body);
  }
  assert.equal([...bodies].join(), JSON.stringify({ error: 'not configured' }));
});

test('a missing or wrong key gives 401 and makes no DB call', async () => {
  setupEnv();
  assert.equal((await call({ action: 'machine-list' }, { key: null })).statusCode, 401);
  assert.equal((await call({ action: 'machine-list' }, { key: 'X'.repeat(40) })).statusCode, 401);
  assert.equal(fake.state.calls.length, 0);
});

test('failed-auth limit is per IP and never locks out the right key', async () => {
  setupEnv();
  const bad = (ip) => call({ action: 'machine-list' }, { key: 'X'.repeat(40), ip });
  for (let i = 0; i < 20; i++) assert.equal((await bad('1.1.1.1')).statusCode, 401, 'attempt ' + i);
  const throttled = await bad('1.1.1.1');
  assert.equal(throttled.statusCode, 429);
  assert.ok(Number(throttled.headers['retry-after']) >= 1);
  assert.equal((await call({ action: 'machine-list' }, { ip: '1.1.1.1' })).statusCode, 200, 'the right key is never throttled');
  assert.equal((await bad('2.2.2.2')).statusCode, 401, 'another IP is unaffected');
  admin._resetRateLimit();
  assert.equal((await bad('1.1.1.1')).statusCode, 401);
});

test('normal limit: 10 requests per minute', async () => {
  setupEnv();
  for (let i = 0; i < 10; i++) assert.equal((await call({ action: 'machine-list' })).statusCode, 200, 'request ' + i);
  assert.equal((await call({ action: 'machine-list' })).statusCode, 429);
});

test('machine-add returns the key once and stores only its hash', async () => {
  setupEnv();
  const res = await call({ action: 'machine-add', name: 'desk' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const { name, key } = json(res);
  assert.equal(name, 'desk');
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  const doc = fake.collection('machines').docs[0];
  assert.equal(doc._id, 'desk');
  assert.equal(doc.keyHash, sha(key));
  assert.equal(doc.revoked, false);
  assert.ok(doc.createdAt instanceof Date);
  assert.ok(!fake.dump().includes(key));
  const second = json(await call({ action: 'machine-add', name: 'other' }));
  assert.notEqual(second.key, key);
});

test('a key issued by machine-add authenticates against notify.js', async () => {
  setupEnv();
  const { key } = json(await call({ action: 'machine-add', name: 'desk' }));
  const sent = [];
  global.fetch = async (url, opts) => { sent.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const req = { method: 'POST', headers: { authorization: 'Bearer ' + key }, body: { project: 'p', text: 'hi' } };
  const res = mockRes(); await notify(req, res);
  assert.equal(res.statusCode, 200);
  assert.ok(sent[0].text.endsWith(' ' + DOT + ' desk'));
});

test('a duplicate name gives 409 and leaves the original hash alone', async () => {
  setupEnv();
  const first = json(await call({ action: 'machine-add', name: 'desk' }));
  const res = await call({ action: 'machine-add', name: 'desk' });
  assert.equal(res.statusCode, 409);
  assert.ok(!('key' in json(res)));
  assert.equal(fake.collection('machines').docs.length, 1);
  assert.equal(fake.collection('machines').docs[0].keyHash, sha(first.key));
});

test('machine names are validated', async () => {
  setupEnv();
  const bad = ['', 'A', 'Upper', '-x', 'a'.repeat(33), 'a b', 'a/b', 5, null, { $ne: null }, ['a']];
  for (const name of bad) { admin._resetRateLimit(); assert.equal((await call({ action: 'machine-add', name })).statusCode, 400, JSON.stringify(name)); }
  admin._resetRateLimit();
  assert.equal((await call({ action: 'machine-add' })).statusCode, 400, 'absent name');
  assert.equal((await call({ action: 'machine-add', name: 'a'.repeat(32) })).statusCode, 200);
});

test('machine-revoke: soft revoke, name stays reserved, takes effect immediately', async () => {
  setupEnv();
  const { key } = json(await call({ action: 'machine-add', name: 'desk' }));
  const send = async () => { const res = mockRes(); global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }); await notify({ method: 'POST', headers: { authorization: 'Bearer ' + key }, body: { project: 'p', text: 'hi' } }, res); return res.statusCode; };
  assert.equal(await send(), 200);
  assert.equal((await call({ action: 'machine-revoke', name: 'desk' })).statusCode, 200);
  const doc = fake.collection('machines').docs[0];
  assert.equal(doc.revoked, true);
  assert.ok(doc.revokedAt instanceof Date);
  assert.equal((await call({ action: 'machine-add', name: 'desk' })).statusCode, 409);
  assert.equal(await send(), 401, 'revoked key rejected at once (cache cleared)');
  assert.equal((await call({ action: 'machine-revoke', name: 'desk' })).statusCode, 200, 'idempotent');
  assert.equal((await call({ action: 'machine-revoke', name: 'ghost' })).statusCode, 404);
});

test('machine-list never exposes hashes', async () => {
  setupEnv();
  const a = json(await call({ action: 'machine-add', name: 'zeta' }));
  const b = json(await call({ action: 'machine-add', name: 'alpha' }));
  await call({ action: 'machine-revoke', name: 'alpha' });
  const res = await call({ action: 'machine-list' });
  const { machines } = json(res);
  assert.deepEqual(machines.map((m) => m.name), ['alpha', 'zeta']);
  assert.equal(machines[0].revoked, true);
  assert.ok(machines[1].createdAt);
  for (const m of machines) assert.ok(!('keyHash' in m));
  for (const secret of [sha(a.key), sha(b.key), a.key, b.key]) assert.ok(!res.body.includes(secret));
});

test('topic-add upserts and validates', async () => {
  setupEnv();
  assert.equal((await call({ action: 'topic-add', project: 'p', threadId: 5 })).statusCode, 200);
  assert.equal((await call({ action: 'topic-add', project: 'p', threadId: 6 })).statusCode, 200);
  assert.equal(fake.collection('topics').docs.length, 1);
  assert.equal(fake.collection('topics').docs[0].threadId, 6);
  assert.equal((await call({ action: 'topic-add', project: '_default', threadId: 1 })).statusCode, 200);
  for (const threadId of [0, -1, 2147483648, 1.5, '5', null, 1e300, { $gt: 0 }, [5]]) {
    admin._resetRateLimit();
    assert.equal((await call({ action: 'topic-add', project: 'p', threadId })).statusCode, 400, JSON.stringify(threadId));
  }
  for (const project of ['', 'x'.repeat(101), 'a\nb', 'a\u0007', ' lead', { $ne: null }, ['a'], 5]) {
    admin._resetRateLimit();
    assert.equal((await call({ action: 'topic-add', project, threadId: 5 })).statusCode, 400, JSON.stringify(project));
  }
});

test('topic-remove and topic-list', async () => {
  setupEnv();
  await call({ action: 'topic-add', project: 'b', threadId: 2 });
  await call({ action: 'topic-add', project: 'a', threadId: 1 });
  assert.deepEqual(json(await call({ action: 'topic-list' })), { topics: [{ project: 'a', threadId: 1 }, { project: 'b', threadId: 2 }] });
  assert.equal((await call({ action: 'topic-remove', project: 'a' })).statusCode, 200);
  assert.equal((await call({ action: 'topic-remove', project: 'a' })).statusCode, 404);
  assert.equal((await call({ action: 'topic-remove', project: { $ne: null } })).statusCode, 400);
  assert.equal((await call({ action: 'topic-remove', project: ['a'] })).statusCode, 400);
});

test('NoSQL injection payloads are rejected before any DB call', async () => {
  setupEnv();
  const evil = [{ $ne: null }, ['a'], { $gt: '' }];
  for (const v of evil) {
    for (const body of [
      { action: 'machine-add', name: v }, { action: 'machine-revoke', name: v },
      { action: 'topic-add', project: v, threadId: v }, { action: 'topic-remove', project: v }]) {
      assert.equal((await call(body)).statusCode, 400, JSON.stringify(body));
    }
    admin._resetRateLimit();
  }
  assert.equal(fake.state.calls.length, 0);
});

test('bad actions and bad bodies give 400', async () => {
  setupEnv();
  for (const body of [{ action: 'nope' }, {}, { action: 5 }, { action: null }, 'not json', [], undefined, { action: 'machine-list', pad: 'x'.repeat(5000) }]) {
    assert.equal((await call(body)).statusCode, 400, String(JSON.stringify(body)).slice(0, 50));
    admin._resetRateLimit();
  }
});

test('a storage failure gives 503 without leaking the connection string', async () => {
  setupEnv(); fake.state.fail = true;
  for (const body of [{ action: 'machine-add', name: 'x' }, { action: 'machine-list' }, { action: 'topic-add', project: 'p', threadId: 5 }]) {
    const res = await call(body);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body, JSON.stringify({ error: 'storage unavailable' }));
    assert.ok(!res.body.includes('SECRET-DB-PASS'));
  }
});

test('secrets never reach responses or logs, and log lines are well formed', async () => {
  setupEnv();
  const cap = captureLogs();
  const seen = [];
  try {
    const added = json(await call({ action: 'machine-add', name: 'desk' }));
    seen.push(added.key);
    await call({ action: 'machine-list' });
    await call({ action: 'topic-add', project: 'my project', threadId: 5 });
    await call({ action: 'topic-remove', project: 'nope' });
    await call({ action: 'machine-add', name: 'Bad Name' });
    await call({ action: 'machine-list' }, { key: 'X'.repeat(40) });
    fake.state.fail = true; await call({ action: 'machine-list' });
  } finally { cap.restore(); }
  assert.ok(cap.lines.length >= 6);
  const text = cap.lines.join('\n');
  for (const secret of [ADMIN_KEY, ...seen, sha(seen[0]), 'SECRET-DB-PASS', DB_URI]) assert.ok(!text.includes(secret), 'log leaks a secret');
  for (const line of cap.lines) assert.match(line, /^admin (action=[a-z-]+ )?status=\d{3}( name=[a-z0-9_-]+| project=.+)?$/);
});

test('every admin response that carries data is marked no-store', async () => {
  setupEnv();
  await call({ action: 'topic-add', project: 'p', threadId: 5 });
  assert.equal((await call({ action: 'machine-list' })).headers['cache-control'], 'no-store');
  assert.equal((await call({ action: 'topic-list' })).headers['cache-control'], 'no-store');
});

test('a body getter that throws gives 400, not a crash', async () => {
  setupEnv();
  const req = { method: 'POST', headers: { authorization: 'Bearer ' + ADMIN_KEY }, get body() { throw new Error('invalid json'); } };
  const res = mockRes();
  await admin(req, res);
  assert.equal(res.statusCode, 400);
});
