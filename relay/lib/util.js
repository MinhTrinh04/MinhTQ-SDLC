'use strict';
const crypto = require('node:crypto');

const MAX_BODY = 4096;

function sha(s) { return crypto.createHash('sha256').update(String(s)).digest(); }
function send(res, code, obj, headers = {}) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}
// Built from code points on purpose: a literal U+2028/U+2029 inside a regex literal would be a JS line terminator.
const INVISIBLE = new RegExp('[' + [0x85, 0x2028, 0x2029, 0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2066, 0x2067, 0x2068, 0x2069, 0xFEFF]
  .map((c) => String.fromCharCode(c)).join('') + ']', 'g');
function clean(s) { return s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(INVISIBLE, '').trim(); }

// First hop of X-Forwarded-For (Vercel sets it); 'unknown' when absent. Used only to throttle repeated failures.
function clientIp(req) {
  const h = req && req.headers && req.headers['x-forwarded-for'];
  const first = typeof h === 'string' ? h.split(',')[0].trim() : '';
  return first || 'unknown';
}
async function readBody(req) {
  if (req.body !== undefined && req.body !== null) {
    return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  }
  if (typeof req[Symbol.asyncIterator] !== 'function') return ''; // no stream: treat as an empty body
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > MAX_BODY) return null; chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = { MAX_BODY, sha, send, clean, clientIp, readBody };
