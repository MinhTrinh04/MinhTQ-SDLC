'use strict';
const crypto = require('node:crypto');
const { MAX_BODY, sha, send, clean, clientIp, readBody } = require('../lib/util');
const store = require('../lib/store');

const WINDOW_MS = 60000, MAX_REQ = 10, MAX_FAIL = 20;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
let okHits = []; // per instance, best-effort (same trade-off as notify.js)
const failsByIp = new Map(); // ip -> timestamps of failed authentications; never applied to a correct key
const MAX_IPS = 1000;
const NO_STORE = { 'Cache-Control': 'no-store' };

const recent = (arr, now) => arr.filter((t) => now - t < WINDOW_MS);
const wait = (arr, now) => Math.max(1, Math.ceil((WINDOW_MS - (now - arr[0])) / 1000));
const log = (s) => console.log('admin ' + s); // only validated, charset-limited values reach the log

function loadConfig() {
  const key = process.env.NOTIFY_ADMIN_KEY, uri = process.env.MONGODB_URI;
  return key && key.length >= 32 && uri ? { key } : null;
}
function isAdmin(header, key) {
  const m = /^Bearer (.+)$/.exec(header || '');
  const same = crypto.timingSafeEqual(sha(m ? m[1] : ''), sha(key)); // equal-length digests
  return !!m && same;
}
const vName = (v) => (typeof v === 'string' && NAME_RE.test(v) ? v : null);
function vProject(v) {
  if (typeof v !== 'string' || v.length < 1 || v.length > 100) return null;
  return clean(v) === v && !/\n/.test(v) ? v : null; // reject, never repair
}
const vThread = (v) => (Number.isSafeInteger(v) && v >= 1 && v <= 2147483647 ? v : null);

async function handler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { Allow: 'POST' });
  const cfg = loadConfig();
  if (!cfg) return send(res, 500, { error: 'not configured' });
  const now = Date.now();
  if (!isAdmin(req.headers && req.headers.authorization, cfg.key)) {
    // Throttle wrong keys per IP. The correct key is never throttled, so an attacker cannot lock the admin out.
    const ip = clientIp(req), fails = recent(failsByIp.get(ip) || [], now);
    if (fails.length >= MAX_FAIL) { failsByIp.set(ip, fails); return send(res, 429, { error: 'rate limited' }, { 'Retry-After': String(wait(fails, now)) }); }
    fails.push(now);
    if (failsByIp.size >= MAX_IPS && !failsByIp.has(ip)) failsByIp.clear(); // bounded memory
    failsByIp.set(ip, fails);
    log('status=401');
    return send(res, 401, { error: 'unauthorized' });
  }
  okHits = recent(okHits, now);
  if (okHits.length >= MAX_REQ) return send(res, 429, { error: 'rate limited' }, { 'Retry-After': String(wait(okHits, now)) });
  okHits.push(now);

  const bad = (action) => { log(`${action ? 'action=' + action + ' ' : ''}status=400`); return send(res, 400, { error: 'bad request' }); };
  let raw; try { raw = await readBody(req); } catch { raw = null; } // a platform body getter can throw on invalid JSON
  if (raw === null || Buffer.byteLength(raw) > MAX_BODY) return bad();
  let b; try { b = JSON.parse(raw); } catch { return bad(); }
  if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.action !== 'string') return bad();

  try {
    switch (b.action) {
      case 'machine-add': {
        const name = vName(b.name); if (!name) return bad('machine-add');
        const key = crypto.randomBytes(32).toString('base64url'); // 43 chars, 256 bits; only its hash is stored
        if (!(await store.addMachine(name, sha(key).toString('hex')))) { log(`action=machine-add status=409 name=${name}`); return send(res, 409, { error: 'name exists' }); }
        log(`action=machine-add status=200 name=${name}`);
        return send(res, 200, { name, key }, { 'Cache-Control': 'no-store' });
      }
      case 'machine-revoke': {
        const name = vName(b.name); if (!name) return bad('machine-revoke');
        const ok = await store.revokeMachine(name);
        log(`action=machine-revoke status=${ok ? 200 : 404} name=${name}`);
        return ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'not found' });
      }
      case 'machine-list': { const machines = await store.listMachines(); log('action=machine-list status=200'); return send(res, 200, { machines }, NO_STORE); }
      case 'topic-add': {
        const project = vProject(b.project), threadId = vThread(b.threadId);
        if (!project || threadId === null) return bad('topic-add');
        await store.setTopic(project, threadId);
        log(`action=topic-add status=200 project=${project}`);
        return send(res, 200, { ok: true });
      }
      case 'topic-remove': {
        const project = vProject(b.project); if (!project) return bad('topic-remove');
        const ok = await store.removeTopic(project);
        log(`action=topic-remove status=${ok ? 200 : 404} project=${project}`);
        return ok ? send(res, 200, { ok: true }) : send(res, 404, { error: 'not found' });
      }
      case 'topic-list': { const topics = await store.listTopics(); log('action=topic-list status=200'); return send(res, 200, { topics }, NO_STORE); }
      default: return bad();
    }
  } catch { log('status=503'); return send(res, 503, { error: 'storage unavailable' }); } // never log the error object
}

module.exports = handler;
module.exports._resetRateLimit = () => { okHits = []; failsByIp.clear(); };
