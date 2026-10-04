'use strict';
const crypto = require('node:crypto');

const MAX_BODY = 4096, MAX_PROJECT = 100, MAX_TEXT = 500;
const WINDOW_MS = 60000, MAX_REQ = 30;
const TG_TIMEOUT_MS = 4000; // two attempts (retry without thread) must fit inside the client's 10 s timeout
const hits = new Map(); // machine name -> array of timestamps (best-effort, per instance)

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest(); }

function send(res, code, obj, headers = {}) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}

function loadConfig() { // null when anything required is missing or invalid
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chat) return null;
    const keys = JSON.parse(process.env.NOTIFY_KEYS || '');
    const entries = Object.entries(keys).filter(([, k]) => typeof k === 'string' && k.length >= 32);
    if (!entries.length) return null;
    const topics = process.env.NOTIFY_TOPICS ? JSON.parse(process.env.NOTIFY_TOPICS) : {};
    if (!topics || typeof topics !== 'object' || Array.isArray(topics)) return null;
    return { token, chat, entries, topics };
  } catch { return null; }
}

function authenticate(header, entries) { // no early exit: every key is compared
  const m = /^Bearer (.+)$/.exec(header || '');
  const given = sha(m ? m[1] : '');
  let machine = null;
  for (const [name, key] of entries) {
    if (crypto.timingSafeEqual(given, sha(key)) && m) machine = machine || name;
  }
  return machine;
}

function clean(s) { return s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').trim(); }

async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  if (typeof req[Symbol.asyncIterator] !== 'function') return ''; // no stream: treat as an empty body
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) return null; chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
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
  const machine = authenticate(req.headers && req.headers.authorization, cfg.entries);
  if (!machine) return send(res, 401, { error: 'unauthorized' });
  const wait = rateLimited(machine);
  if (wait) return send(res, 429, { error: 'rate limited' }, { 'Retry-After': String(wait) });

  const raw = await readBody(req);
  if (raw === null || Buffer.byteLength(raw) > MAX_BODY) return send(res, 400, { error: 'bad request' });
  let b; try { b = JSON.parse(raw); } catch { return send(res, 400, { error: 'bad request' }); }
  if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.project !== 'string' || typeof b.text !== 'string')
    return send(res, 400, { error: 'bad request' });
  const project = clean(b.project).replace(/\n+/g, ' ').trim(), text = clean(b.text); // no newlines in project: it is logged
  if (!project || project.length > MAX_PROJECT || !text || text.length > MAX_TEXT)
    return send(res, 400, { error: 'bad request' });

  const has = (k) => Object.prototype.hasOwnProperty.call(cfg.topics, k);
  const valid = (v) => Number.isSafeInteger(v) && v > 0 && v <= 2147483647; // Telegram thread ids are 32-bit
  const thread = has(project) && valid(cfg.topics[project]) ? cfg.topics[project]
    : (has('_default') && valid(cfg.topics._default) ? cfg.topics._default : null);
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
module.exports._resetRateLimit = () => hits.clear();
