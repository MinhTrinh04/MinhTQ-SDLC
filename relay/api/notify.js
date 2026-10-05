'use strict';
const { MAX_BODY, sha, send, clean, clientIp, readBody } = require('../lib/util');
const store = require('../lib/store');

const MAX_PROJECT = 100, MAX_TEXT = 500;
const WINDOW_MS = 60000, MAX_REQ = 30;
const TG_TIMEOUT_MS = 4000; // two attempts (retry without thread) must fit inside the client's 10 s timeout
const hits = new Map(); // machine name -> array of timestamps (best-effort, per instance)
const MAX_IP_FAILS = 30, MAX_IPS = 1000;
const failsByIp = new Map(); // ip -> timestamps of failed authentications (best-effort, per instance)

function recentFails(ip, now) { return (failsByIp.get(ip) || []).filter((t) => now - t < WINDOW_MS); }
function ipThrottled(ip) { return recentFails(ip, Date.now()).length >= MAX_IP_FAILS; }
function noteFailure(ip) {
  const now = Date.now(), arr = recentFails(ip, now);
  arr.push(now);
  if (failsByIp.size >= MAX_IPS && !failsByIp.has(ip)) failsByIp.clear(); // bounded memory
  failsByIp.set(ip, arr);
}

function loadConfig() { // null when anything required is missing
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID, uri = process.env.MONGODB_URI;
  return token && chat && uri ? { token, chat } : null;
}
async function authenticate(header, allowDb) { // machine name or null; throws when storage is down
  const m = /^Bearer (.+)$/.exec(header || '');
  return m ? store.findMachineByKeyHash(sha(m[1]).toString('hex'), allowDb) : null;
}

function rateLimited(machine) { // seconds to wait, or 0 when allowed
  const now = Date.now();
  const arr = (hits.get(machine) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX_REQ) { hits.set(machine, arr); return Math.ceil((WINDOW_MS - (now - arr[0])) / 1000); }
  arr.push(now); hits.set(machine, arr); return 0;
}

async function tg(cfg, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TG_TIMEOUT_MS);
  try {
    const r = await fetch(`https://api.telegram.org/bot${cfg.token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctl.signal });
    let j = null; try { j = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, description: j && j.description ? String(j.description) : '' };
  } catch { return { ok: false, status: 0, description: '' }; }
  finally { clearTimeout(timer); }
}

async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });
  const cfg = loadConfig();
  if (!cfg) return send(res, 500, { error: 'not configured' });
  const ip = clientIp(req);
  let machine;
  // An IP that keeps failing authentication may no longer trigger database lookups (it still gets cached keys).
  try { machine = await authenticate(req.headers && req.headers.authorization, !ipThrottled(ip)); }
  catch { console.log('notify status=503'); return send(res, 503, { error: 'storage unavailable' }); } // never log the error object
  if (!machine) { noteFailure(ip); return send(res, 401, { error: 'unauthorized' }); }
  const wait = rateLimited(machine);
  if (wait) return send(res, 429, { error: 'rate limited' }, { 'Retry-After': String(wait) });

  let raw; try { raw = await readBody(req); } catch { raw = null; } // a platform body getter can throw on invalid JSON
  if (raw === null || Buffer.byteLength(raw) > MAX_BODY) return send(res, 400, { error: 'bad request' });
  let b; try { b = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad request' }); }
  if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.project !== 'string' || typeof b.text !== 'string')
    return send(res, 400, { error: 'bad request' });
  const project = clean(b.project).replace(/\n+/g, ' ').trim(), text = clean(b.text); // no newlines in project: it is logged
  if (!project || project.length > MAX_PROJECT || !text || text.length > MAX_TEXT)
    return send(res, 400, { error: 'bad request' });

  let thread = null;
  try { thread = await store.findTopic(project); } catch { /* topic lookup failed: post to General */ }
  const body = { chat_id: cfg.chat, text: `${text} \u00b7 ${machine}` }; // no parse_mode: plain text only
  if (thread !== null) body.message_thread_id = thread;

  let r = await tg(cfg, body);
  if (!r.ok && r.status === 400 && thread !== null && /thread not found|topic_closed|topic_deleted/i.test(r.description)) {
    delete body.message_thread_id; r = await tg(cfg, body); // topic deleted/closed: post to General once
  }
  console.log(`notify machine=${machine} project=${project} status=${r.ok ? 200 : 502}`); // never log text, token or keys
  return r.ok ? send(res, 200, { ok: true }) : send(res, 502, { error: 'upstream error' });
}

module.exports = handler;
module.exports._resetRateLimit = () => { hits.clear(); failsByIp.clear(); };
