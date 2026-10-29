// 10-29 (Dominic): cajunappfactory.com sends StopScope traffic to stopscope.com. Before: links and redirects pointed at /stopscope/ pages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const R = new URL('../../', import.meta.url), rd = p => readFileSync(new URL(p, R), 'utf8');
test('StopScope links and redirects go straight to stopscope.com', () => {
  for (const f of ['index.html', 'privacy/index.html']) assert.doesNotMatch(rd(f), /href="\/stopscope\//, f);
  assert.match(rd('index.html'), /href="https:\/\/stopscope\.com\/privacy\/"/);
  const rules = new Map(rd('_redirects').split('\n').filter(l => l && !l.startsWith('#')).map(l => { const [a, b, c] = l.trim().split(/\s+/); return [a, [b, c]]; }));
  for (const p of ['/stopscope', '/stopscope/', '/stopscope/index.html', '/mystops', '/mystops/', '/mystops/index.html']) assert.deepEqual(rules.get(p), ['https://stopscope.com/', '301'], p);
  for (const p of ['/stopscope/privacy', '/stopscope/privacy/', '/stopscope/privacy/index.html', '/mystops/privacy', '/mystops/privacy/', '/mystops/privacy/index.html']) assert.deepEqual(rules.get(p), ['https://stopscope.com/privacy/', '301'], p);
  for (const f of ['stopscope/index.html', 'stopscope/privacy/index.html', 'mystops/index.html', 'mystops/privacy/index.html']) assert.ok(!existsSync(new URL(f, R)), f + ' would win over _redirects');
  assert.ok(existsSync(new URL('privacy/index.html', R)) && existsSync(new URL('app-ads.txt', R)));
});
