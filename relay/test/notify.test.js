'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../api/notify.js');

const KEY_A = 'a'.repeat(32), KEY_B = 'b'.repeat(40);
const BOT = '123456:SECRET-BOT-TOKEN';

function setEnv(over = {}) {
  process.env.TELEGRAM_BOT_TOKEN = BOT;
  process.env.TELEGRAM_CHAT_ID = '-100123';
  process.env.NOTIFY_KEYS = JSON.stringify({ laptop: KEY_A, desk: KEY_B });
  process.env.NOTIFY_TOPICS = JSON.stringify({ projA: 11, _default: 99 });
  for (const [k, v] of Object.entries(over)) { if (v === null) delete process.env[k]; else process.env[k] = v; }
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
function fresh(over) { setEnv(over); mockFetch(); }

test('GET gives 405 with Allow: POST', async () => {
  fresh();
  const res = await call({ method: 'GET' });
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
});

test('missing and wrong key give 401 and never reach Telegram', async () => {
  fresh();
  assert.equal((await call({ key: null })).statusCode, 401);
  assert.equal((await call({ key: 'z'.repeat(32) })).statusCode, 401);
  assert.equal(calls.length, 0);
});

test('key order in NOTIFY_KEYS does not matter and machine name is appended', async () => {
  for (const keys of [{ desk: KEY_B, laptop: KEY_A }, { laptop: KEY_A, desk: KEY_B }]) {
    fresh({ NOTIFY_KEYS: JSON.stringify(keys) });
    assert.equal((await call({ key: KEY_A })).statusCode, 200);
    assert.ok(calls[0].body.text.endsWith(' \u00b7 laptop'));
    fresh({ NOTIFY_KEYS: JSON.stringify(keys) });
    assert.equal((await call({ key: KEY_B })).statusCode, 200);
    assert.ok(calls[0].body.text.endsWith(' \u00b7 desk'));
  }
});

test('a key shorter than 32 chars is ignored', async () => {
  fresh({ NOTIFY_KEYS: JSON.stringify({ laptop: KEY_A, short: 'abc' }) });
  assert.equal((await call({ key: 'abc' })).statusCode, 401);
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
  fresh({ NOTIFY_TOPICS: JSON.stringify({ projA: 11 }) });
  await call({ body: { project: 'other', text: 'hi' } });
  assert.ok(!('message_thread_id' in calls[0].body));
});

test('prototype property names never resolve to a thread', async () => {
  fresh({ NOTIFY_TOPICS: JSON.stringify({ projA: 11 }) });
  for (const project of ['constructor', '__proto__', 'toString']) {
    await call({ body: { project, text: 'hi' } });
  }
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

test('the bot token never appears in any response', async () => {
  const seen = [];
  fresh(); seen.push(await call());
  seen.push(await call({ method: 'GET' }));
  seen.push(await call({ key: null }));
  seen.push(await call({ body: [] }));
  setEnv(); mockFetch({ status: 400, json: { ok: false, description: `leak ${BOT}` } });
  seen.push(await call());
  setEnv({ TELEGRAM_BOT_TOKEN: null }); seen.push(await call());
  fresh();
  for (let i = 0; i < 31; i++) seen.push(await call());
  for (const res of seen) assert.ok(!JSON.stringify(res).includes(BOT));
});

test('missing or broken configuration gives an identical 500', async () => {
  const bodies = new Set();
  for (const over of [{ TELEGRAM_BOT_TOKEN: null }, { TELEGRAM_CHAT_ID: null }, { NOTIFY_KEYS: null }, { NOTIFY_KEYS: '{not json' }]) {
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
    fresh({ NOTIFY_TOPICS: JSON.stringify({ projA: id }) });
    await call();
    assert.ok(!('message_thread_id' in calls[0].body), String(id));
  }
});

test('newlines in project cannot forge log lines', async () => {
  fresh();
  const lines = []; const orig = console.log; console.log = (s) => lines.push(String(s));
  try { await call({ body: { project: 'x\nnotify machine=evil project=y status=200', text: 'hi' } }); }
  finally { console.log = orig; }
  assert.equal(lines.length, 1);
  assert.ok(!lines[0].includes('\n'));
});
