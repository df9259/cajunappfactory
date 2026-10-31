// 10-31 audit #7: the emailed-code hash is compared in constant time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from '../src/mail.js';
test('timingSafeEqual: equal, different, different length, non-string', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual(undefined, 'abc'), false);
});
test('login/code compares the code hash with timingSafeEqual', () => {
  const src = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(src, /timingSafeEqual\(r\.code_hash, await sha256\(email \+ ':' \+ code\)\)/);
  assert.doesNotMatch(src, /r\.code_hash !==/);
});
