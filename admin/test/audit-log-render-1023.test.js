// 10-23: the user panel's Audit log showed "[object HTMLDivElement],..." because an ARRAY of elements was passed to
// replaceChildren (which stringifies non-nodes). Every render now goes through put()/$ which flatten nested arrays fully.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGE } from '../src/ui.js';

class El { constructor(t) { this.tag = t; this.nodeType = 1; this.kids = []; this.attrs = {}; }
  setAttribute(k, v) { this.attrs[k] = v; } addEventListener() {}
  append(...c) { for (const x of c) this.kids.push(x); } replaceChildren(...c) { this.kids = c; } }
const doc = { createElement: (t) => new El(t) };
const grab = (name) => { const m = new RegExp('^const \\' + name + '=.*$', 'm').exec(PAGE.js); assert.ok(m, name + ' helper missing'); return m[0]; };
const helpers = new Function('document', grab('kids') + '\n' + grab('$') + '\n' + grab('put') + '\nreturn { $, put };')(doc);

test('nested arrays of elements are appended as elements, never as text', () => {
  const { $, put } = helpers, box = new El('div');
  put(box, $('b', {}, 'Audit log'), [$('div', {}, 'a'), $('div', {}, 'b')], null);
  assert.equal(box.kids.length, 3);
  assert.ok(box.kids.every((k) => typeof k === 'object' && k.nodeType === 1));
  const p = $('p', {}, [[$('i', {}, 'x')], 'y']);
  assert.equal(p.kids[0].tag, 'i'); assert.equal(p.kids[1], 'y');
});
test('no render calls replaceChildren directly (only put does)', () => {
  const calls = PAGE.js.match(/\.replaceChildren\(/g) || [];
  assert.equal(calls.length, 1);
  assert.doesNotMatch(PAGE.js, /\[object /);
});
