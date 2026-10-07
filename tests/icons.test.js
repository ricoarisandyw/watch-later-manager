import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
// a very small stand-in for the DOM: just elements that remember their attributes and children
class FakeEl {
  constructor(tag) {
    this.tag = tag;
    this.attrs = {};
    this.kids = [];
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  append(...kids) {
    this.kids.push(...kids);
  }
}
globalThis.document = { createElementNS: (_ns, tag) => new FakeEl(tag) };

const { ICON_NAMES, icon } = await import('../lib/icons.js');

const files = [
  ...['content', 'lib', 'popup', 'options'].flatMap((dir) =>
    readdirSync(new URL(`../${dir}/`, import.meta.url))
      .filter((f) => /\.(js|html)$/.test(f))
      .map((f) => `${dir}/${f}`),
  ),
  'background.js',
];
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('every icon the pages ask for exists in the icon set', () => {
  const asked = new Set();
  for (const f of files) {
    if (f === 'lib/icons.js') continue;
    const src = read(f);
    for (const m of src.matchAll(/\bicon\('([a-z-]+)'/g)) asked.add(m[1]);
    for (const m of src.matchAll(/data-icon="([a-z-]+)"/g)) asked.add(m[1]);
    for (const m of src.matchAll(/\b(?:icon|textIcon|subIcon): '([a-z-]+)'/g)) asked.add(m[1]);
  }
  // the Stats insights name their icon as the second argument of add(key, icon, tone, text)
  for (const m of read('lib/insights.js').matchAll(/add\(\s*'[a-z]+',\s*'([a-z-]+)'/g)) asked.add(m[1]);
  assert.ok(asked.size > 20, 'found the icons in use');
  for (const name of asked) assert.ok(ICON_NAMES.includes(name), `missing icon: ${name}`);
});

test('no emoji or symbol characters are left in the pages', () => {
  const symbols = /[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{2190}-\u{21FF}\u{FE0F}]/u;
  // a tab title and the toolbar badge can only hold text, so those two stay
  const allowed = new Set(['content/alarm.js', 'background.js']);
  for (const f of files) {
    if (allowed.has(f)) continue;
    const bad = read(f)
      .split('\n')
      .filter((line) => symbols.test(line));
    assert.deepEqual(bad, [], `${f} still has emoji or symbols`);
  }
});

test('icon paths only hold drawing commands and numbers', async () => {
  const src = read('lib/icons.js');
  for (const m of src.matchAll(/'([Mm][^']*)'/g)) {
    assert.match(m[1], /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/, m[1]);
  }
});

test('icons are duotone: a soft fill under the outline, both in the text colour', () => {
  const trash = icon('trash');
  assert.equal(trash.attrs.stroke, 'currentColor');
  assert.equal(trash.attrs.fill, 'none');
  const soft = trash.kids.filter((k) => k.attrs['fill-opacity']);
  const lines = trash.kids.filter((k) => !k.attrs['fill-opacity']);
  assert.equal(soft.length, 1, 'only the bin gets the soft fill');
  assert.equal(soft[0].attrs.fill, 'currentColor');
  assert.ok(lines.length >= 3, 'the lid and handle stay as plain lines');
  // closed shapes (circles, rectangles, paths ending in z) are filled, open lines never are
  assert.ok(icon('alarm-clock').kids.some((k) => k.tag === 'circle' && k.attrs['fill-opacity']));
  assert.ok(icon('play').kids.every((k) => k.attrs['fill-opacity']));
  assert.ok(icon('x').kids.every((k) => !k.attrs['fill-opacity']));
});
