'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const handler = require('../api/notify.js');
const db = require('../lib/db.js'), store = require('../lib/store.js');
const { makeFakeDb } = require('./fake-db.js');

const hash = (k) => crypto.createHash('sha256').update(k).digest('hex');
const KEY_A = 'a'.repeat(32), KEY_B = 'b'.repeat(40);
const BOT = '123456:SECRET-BOT-TOKEN', DB_URI = 'mongodb://u:SECRET-DB-PASS@fake.invalid/x';
let fake;

function seedDb(over = {}) {
  const machines = over.machines || [
    { _id: 'laptop', keyHash: hash(KEY_A), createdAt: new Date(), revoked: false },
    { _id: 'desk', keyHash: hash(KEY_B), createdAt: new Date(), revoked: false }];
  const topics = over.topics || [{ _id: 'projA', threadId: 11 }, { _id: '_default', threadId: 99 }];
  fake = makeFakeDb({ machines, topics });
  db._setDb(fake); store._resetCache(); store._setClock(null);
}
function setEnv(over = {}, seed = {}) {
  process.env.TELEGRAM_BOT_TOKEN = BOT;
  process.env.TELEGRAM_CHAT_ID = '-100123';
  process.env.MONGODB_URI = DB_URI;
  for (const [k, v] of Object.entries(over)) { if (v === null) delete process.env[k]; else process.env[k] = v; }
  seedDb(seed);
  handler._resetRateLimit();
}
function mockRes() {
  const r = { statusCode: 0, headers: {}, body: '' };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.end = (b) => { r.body = b || ''; };
  return r;
}
async function call(opts = {}) {
  const { method = 'POST', key = KEY_A, headers = {} } = opts;
  const body = 'body' in opts ? opts.body : { project: 'projA', text: 'hi' }; // an explicit undefined must stay undefined
  const req = { method, headers: { ...(key ? { authorization: 'Bearer ' + key } : {}), 'content-type': 'application/json', ...headers }, body };
  const res = mockRes();
  await handler(req, res);
  return res;
}
let calls;
function mockFetch(...responses) { // each: { status, json }
  calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), signal: opts.signal });
    const r = responses.shift() || { status: 200, json: { ok: true } };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
  };
}
function fresh(over, seed) { setEnv(over, seed); mockFetch(); }
function captureLogs() {
  const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.map(String).join(' '));
  return { lines, restore: () => { console.log = orig; } };
}
const finds = (name) => fake.state.calls.filter((c) => c === name).length;

test('GET gives 405 with Allow: POST', async () => {
  fresh();
  const res = await call({ method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
});

test('missing and wrong key give 401 and never reach Telegram', async () => {
  fresh();
  assert.equal((await call({ key: null })).statusCode, 401);
  assert.equal(finds('machines.findOne'), 0, 'a missing key makes no lookup');
  assert.equal((await call({ key: 'z'.repeat(32) })).statusCode, 401);
  assert.equal(finds('machines.findOne'), 1, 'a wrong key makes one lookup');
  assert.equal(calls.length, 0);
});

test('each stored key authenticates as its own machine, whatever the insertion order', async () => {
  const laptop = { _id: 'laptop', keyHash: hash(KEY_A), createdAt: new Date(), revoked: false };
  const desk = { _id: 'desk', keyHash: hash(KEY_B), createdAt: new Date(), revoked: false };
  for (const machines of [[desk, laptop], [laptop, desk]]) {
    fresh({}, { machines });
    assert.equal((await call({ key: KEY_A })).statusCode, 200);
    assert.ok(calls[0].body.text.endsWith(' \u00b7 laptop'));
    fresh({}, { machines });
    assert.equal((await call({ key: KEY_B })).statusCode, 200);
    assert.ok(calls[0].body.text.endsWith(' \u00b7 desk'));
  }
});

test('a short or unknown key gives 401', async () => {
  fresh();
  for (const key of ['abc', 'z'.repeat(64)]) assert.equal((await call({ key })).statusCode, 401, key);
  assert.equal(calls.length, 0);
});

test('a revoked key gives 401 and never reaches Telegram', async () => {
  fresh({}, { machines: [{ _id: 'laptop', keyHash: hash(KEY_A), createdAt: new Date(), revoked: true }] });
  assert.equal((await call({ key: KEY_A })).statusCode, 401);
  assert.equal(calls.length, 0);
});

test('400 for malformed or oversized input', async () => {
  fresh();
  const bad = [
    undefined,
    'not json',
    [],
    { project: 'projA', text: 'x'.repeat(501) },
    { project: 'p'.repeat(101), text: 'hi' },
    { project: 'projA', text: '' },
    { project: 'projA', text: '\u0007\u0000' },
    { project: 'projA', text: 42 },
    { project: 'projA', text: 'x'.repeat(5000) },
    { project: 'projA', text: 'hi', junk: 'x'.repeat(5000) },
  ];
  for (const body of bad) {
    const res = await call({ body });
    assert.equal(res.statusCode, 400, String(JSON.stringify(body)).slice(0, 60));
  }
  assert.equal(calls.length, 0);
});

test('control characters are stripped but newlines are kept', async () => {
  fresh();
  assert.equal((await call({ body: { project: 'projA', text: 'a\u0007b\nc' } })).statusCode, 200);
  assert.ok(calls[0].body.text.startsWith('ab\nc'));
});

test('200 sends to the mapped topic with plain text', async () => {
  fresh();
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(calls[0].url, `https://api.telegram.org/bot${BOT}/sendMessage`);
  assert.equal(calls[0].body.chat_id, '-100123');
  assert.equal(calls[0].body.message_thread_id, 11);
  assert.ok(!('parse_mode' in calls[0].body));
});

test('unknown project uses _default, or no thread when there is none', async () => {
  fresh();
  await call({ body: { project: 'other', text: 'hi' } });
  assert.equal(calls[0].body.message_thread_id, 99);
  fresh({}, { topics: [{ _id: 'projA', threadId: 11 }] });
  await call({ body: { project: 'other', text: 'hi' } });
  assert.ok(!('message_thread_id' in calls[0].body));
});

test('prototype property names never resolve to a thread', async () => {
  fresh({}, { topics: [{ _id: 'projA', threadId: 11 }] });
  for (const project of ['constructor', '__proto__', 'toString']) {
    await call({ body: { project, text: 'hi' } });
  }
  assert.equal(calls.length, 3);
  for (const c of calls) assert.ok(!('message_thread_id' in c.body));
});

test('a deleted topic is retried once without the thread', async () => {
  setEnv();
  mockFetch({ status: 400, json: { ok: false, description: 'Bad Request: message thread not found' } }, { status: 200, json: { ok: true } });
  const res = await call();
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.message_thread_id, 11);
  assert.ok(!('message_thread_id' in calls[1].body));
});

test('other Telegram failures give 502 without retry', async () => {
  for (const resp of [{ status: 400, json: { ok: false, description: 'Bad Request: chat not found' } }, { status: 500, json: {} }]) {
    setEnv(); mockFetch(resp);
    const res = await call();
    assert.equal(res.statusCode, 502);
    assert.equal(calls.length, 1);
    assert.equal(res.body, JSON.stringify({ error: 'upstream error' }));
  }
  setEnv();
  global.fetch = async () => { throw Object.assign(new Error('aborted'), { name: 'AbortError' }); };
  assert.equal((await call()).statusCode, 502);
});

test('rate limit: 30 per minute per machine, others unaffected', async () => {
  fresh();
  for (let i = 0; i < 30; i++) assert.equal((await call()).statusCode, 200, 'request ' + i);
  const limited = await call();
  assert.equal(limited.statusCode, 429);
  assert.ok(Number(limited.headers['retry-after']) >= 1);
  assert.equal((await call({ key: KEY_B })).statusCode, 200);
  handler._resetRateLimit();
  assert.equal((await call()).statusCode, 200);
});

test('no secret appears in any response', async () => {
  const seen = [];
  fresh(); seen.push(await call());
  seen.push(await call({ method: 'GET' }));
  seen.push(await call({ key: null }));
  seen.push(await call({ body: [] }));
  setEnv(); mockFetch({ status: 400, json: { ok: false, description: `leak ${BOT}` } });
  seen.push(await call());
  setEnv({ TELEGRAM_BOT_TOKEN: null }); seen.push(await call());
  fresh(); fake.state.fail = true; seen.push(await call());
  fresh();
  for (let i = 0; i < 31; i++) seen.push(await call());
  for (const res of seen) {
    const text = JSON.stringify(res);
    for (const secret of [BOT, 'SECRET-DB-PASS', hash(KEY_A), DB_URI]) assert.ok(!text.includes(secret), secret);
  }
});

test('missing or broken configuration gives an identical 500', async () => {
  const bodies = new Set();
  for (const over of [{ TELEGRAM_BOT_TOKEN: null }, { TELEGRAM_CHAT_ID: null }, { MONGODB_URI: null }, { MONGODB_URI: '' }]) {
    fresh(over);
    const res = await call();
    assert.equal(res.statusCode, 500);
    bodies.add(res.body);
  }
  assert.equal(bodies.size, 1);
  assert.equal([...bodies][0], JSON.stringify({ error: 'not configured' }));
});

test('the Telegram request carries an abort signal (timeout)', async () => {
  fresh();
  await call();
  assert.ok(calls[0].signal instanceof AbortSignal);
});

test('a closed or deleted topic also falls back to General', async () => {
  for (const description of ['Bad Request: TOPIC_CLOSED', 'Bad Request: TOPIC_DELETED']) {
    setEnv();
    mockFetch({ status: 400, json: { ok: false, description } }, { status: 200, json: { ok: true } });
    const res = await call();
    assert.equal(res.statusCode, 200, description);
    assert.equal(calls.length, 2);
    assert.ok(!('message_thread_id' in calls[1].body));
  }
});

test('an out-of-range topic id is never sent to Telegram', async () => {
  for (const id of [1e300, 2147483648, -5, 0, 1.5, '11']) {
    fresh({}, { topics: [{ _id: 'projA', threadId: id }] });
    await call();
    assert.ok(!('message_thread_id' in calls[0].body), String(id));
  }
});

test('newlines in project cannot forge log lines', async () => {
  fresh();
  const cap = captureLogs();
  try { await call({ body: { project: 'x\nnotify machine=evil project=y status=200', text: 'hi' } }); }
  finally { cap.restore(); }
  assert.equal(cap.lines.length, 1);
  assert.ok(!cap.lines[0].includes('\n'));
});

test('DB-backed auth: the plaintext key is not in the database', async () => {
  fresh();
  assert.equal((await call()).statusCode, 200);
  assert.ok(!fake.dump().includes(KEY_A));
});

test('30 s cache: a revoked key stays valid for at most 30 s', async () => {
  fresh();
  let t = 1e6; store._setClock(() => t);
  assert.equal((await call()).statusCode, 200);
  fake.collection('machines').docs[0].revoked = true;
  t = 1e6 + 29999;
  assert.equal((await call()).statusCode, 200);
  t = 1e6 + 30001;
  assert.equal((await call()).statusCode, 401);
});

test('a valid cached key makes no second DB lookup within the TTL', async () => {
  fresh();
  let t = 1e6; store._setClock(() => t);
  await call(); await call(); await call();
  assert.equal(finds('machines.findOne'), 1);
});

test('unknown keys are not cached', async () => {
  fresh();
  assert.equal((await call({ key: 'q'.repeat(40) })).statusCode, 401);
  fake.collection('machines').docs.push({ _id: 'late', keyHash: hash('q'.repeat(40)), createdAt: new Date(), revoked: false });
  assert.equal((await call({ key: 'q'.repeat(40) })).statusCode, 200);
});

test('_default topic comes from the DB', async () => {
  fresh();
  await call({ body: { project: 'brand-new', text: 'hi' } });
  assert.equal(calls[0].body.message_thread_id, 99);
});

test('topic cache keeps misses for 30 s end to end', async () => {
  fresh({}, { topics: [{ _id: 'projA', threadId: 11 }] });
  let t = 1e6; store._setClock(() => t);
  await call({ body: { project: 'p2', text: 'hi' } });
  assert.ok(!('message_thread_id' in calls[0].body));
  fake.collection('topics').docs.push({ _id: 'p2', threadId: 7 });
  await call({ body: { project: 'p2', text: 'hi' } });
  assert.ok(!('message_thread_id' in calls[1].body), 'cached miss');
  t = 1e6 + 30001;
  await call({ body: { project: 'p2', text: 'hi' } });
  assert.equal(calls[2].body.message_thread_id, 7);
});

test('503 when the store throws on the key lookup', async () => {
  fresh(); fake.state.fail = true;
  const cap = captureLogs();
  let res;
  try { res = await call(); } finally { cap.restore(); }
  assert.equal(res.statusCode, 503);
  assert.equal(res.body, JSON.stringify({ error: 'storage unavailable' }));
  assert.equal(calls.length, 0, 'Telegram is not called');
  const everything = res.body + cap.lines.join('\n');
  for (const secret of ['SECRET-DB-PASS', KEY_A, hash(KEY_A), DB_URI]) assert.ok(!everything.includes(secret), secret);
});

test('topic lookup failure still delivers to General', async () => {
  fresh();
  assert.equal((await call()).statusCode, 200); // caches the key
  fake.state.fail = true;
  const res = await call({ body: { project: 'new-project', text: 'hi' } });
  assert.equal(res.statusCode, 200);
  assert.ok(!('message_thread_id' in calls[1].body));
});

test('secrets never reach the logs', async () => {
  fresh();
  const cap = captureLogs();
  try {
    await call();
    await call({ key: 'z'.repeat(40) });
    mockFetch({ status: 500, json: {} }); await call();
    fake.state.fail = true; store._resetCache(); await call();
  } finally { cap.restore(); }
  assert.equal(cap.lines.length, 3, 'one line each for 200, 502 and 503; a 401 logs nothing');
  const text = cap.lines.join('\n');
  for (const secret of [BOT, KEY_A, hash(KEY_A), DB_URI, 'SECRET-DB-PASS']) assert.ok(!text.includes(secret), secret);
});

test('an IP that keeps sending unknown keys loses database lookups but keeps the cache', async () => {
  fresh();
  const ip = { 'x-forwarded-for': '9.9.9.9' };
  assert.equal((await call({ headers: ip })).statusCode, 200, 'warms the cache for KEY_A');
  const before = finds('machines.findOne');
  for (let i = 0; i < 30; i++) assert.equal((await call({ key: 'u'.repeat(30) + i, headers: ip })).statusCode, 401);
  assert.equal(finds('machines.findOne') - before, 30, 'each of the first 30 failures reached the database');
  const mid = finds('machines.findOne');
  assert.equal((await call({ key: 'v'.repeat(40), headers: ip })).statusCode, 401);
  assert.equal(finds('machines.findOne'), mid, 'no database lookup once the IP is over the limit');
  assert.equal((await call({ key: KEY_B, headers: ip })).statusCode, 401, 'a valid but uncached key gets no lookup from that IP');
  assert.equal(finds('machines.findOne'), mid);
  assert.equal((await call({ headers: ip })).statusCode, 200, 'the cached key still works');
  assert.equal((await call({ key: KEY_B, headers: { 'x-forwarded-for': '8.8.8.8' } })).statusCode, 200, 'another IP is unaffected');
  handler._resetRateLimit();
  assert.equal((await call({ key: KEY_B, headers: ip })).statusCode, 200);
});

test('a body getter that throws gives 400, not a crash', async () => {
  fresh();
  const req = { method: 'POST', headers: { authorization: 'Bearer ' + KEY_A }, get body() { throw new Error('invalid json'); } };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});
