'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { clean, clientIp } = require('../lib/util.js');

const chars = (...codes) => codes.map((c) => String.fromCharCode(c)).join('');

test('clean strips control, line-separator and bidi/zero-width characters but keeps newlines and normal text', () => {
  assert.equal(clean('a' + chars(0x07, 0x00) + 'b\nc'), 'ab\nc');
  for (const c of [0x85, 0x2028, 0x2029, 0x200B, 0x200D, 0x200E, 0x202A, 0x202E, 0x2066, 0x2069, 0xFEFF]) {
    assert.equal(clean('x' + String.fromCharCode(c) + 'y'), 'xy', 'U+' + c.toString(16));
  }
  assert.equal(clean('  Claude da xong  '), 'Claude da xong');
  assert.equal(clean('Claude ' + chars(0x0111, 0x00e3) + ' xong'), 'Claude ' + chars(0x0111, 0x00e3) + ' xong');
});

test('clientIp takes the first forwarded address and falls back to unknown', () => {
  assert.equal(clientIp({ headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } }), '1.2.3.4');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': ' 5.6.7.8 ' } }), '5.6.7.8');
  assert.equal(clientIp({ headers: {} }), 'unknown');
  assert.equal(clientIp({}), 'unknown');
  assert.equal(clientIp({ headers: { 'x-forwarded-for': ['a'] } }), 'unknown');
});
