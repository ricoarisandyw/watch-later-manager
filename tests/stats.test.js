import test from 'node:test';
import assert from 'node:assert/strict';

// A very small stand-in for the browser DOM: just enough for the Stats tab to build itself in Node.
class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.attrs = {};
    this.children = [];
    this.style = {};
    this.listeners = {};
    this.className = '';
    this._text = '';
    this.hidden = false;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  getAttribute(k) {
    return this.attrs[k];
  }
  append(...kids) {
    for (const k of kids) this.children.push(typeof k === 'string' ? { text: k } : k);
  }
  prepend(...kids) {
    this.children.unshift(...kids);
  }
  replaceChildren(...kids) {
    this.children = [];
    this.append(...kids);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  set textContent(v) {
    this._text = String(v);
  }
  get textContent() {
    return this._text;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 700, height: 200 };
  }
  get offsetWidth() {
    return 100;
  }
  get offsetHeight() {
    return 40;
  }
}
globalThis.document = {
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (_ns, tag) => new FakeEl(tag),
};

const { renderStats, niceScale, barPath } = await import('../content/stats.js');

const DAY = 86_400_000;
const NOW = new Date(2025, 5, 20, 12).getTime();
const ev = (type, id, t, extra = {}) => ({ t, type, id, ...extra });

// everything inside a node, as plain text
function textOf(node) {
  if (node.text !== undefined) return node.text;
  return [node._text, ...node.children.map(textOf)].join(' ');
}
function walk(node, visit) {
  visit(node);
  for (const c of node.children || []) walk(c, visit);
}
const find = (node, pred) => {
  const out = [];
  walk(node, (n) => pred(n) && out.push(n));
  return out;
};
// HTML elements keep their classes in className, SVG ones in the class attribute
const hasClass = (n, cls) => `${n.className || ''} ${(n.attrs && n.attrs.class) || ''}`.split(/\s+/).includes(cls);

function sampleCtx(over = {}) {
  const events = [];
  const videos = [];
  // 12 videos added over the last 24 days (every 2 days), the first 5 finished, one thrown away
  for (let i = 0; i < 12; i++) {
    const id = `video${String(i).padStart(6, '0')}`;
    const t = NOW - (24 - i * 2) * DAY;
    events.push(ev('added', id, t, { source: 'rightclick', durationSec: 600 + i * 300, channel: i % 2 ? 'Alpha' : 'Beta' }));
    if (i < 5) events.push(ev('finished', id, t + DAY, { durationSec: 600 }));
    videos.push({ id, list: 'watchLater', addedAt: t, durationSec: 600, channel: 'Alpha', title: 't', tags: [] });
  }
  events.push(ev('removed', 'video000009', NOW - 3 * DAY, { reason: 'manual', durationSec: 600 }));
  const snapshots = {};
  for (let i = 0; i < 6; i++) {
    const d = new Date(NOW - (5 - i) * DAY);
    snapshots[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`] = {
      n: 5 + i,
      sec: 3000 + i * 600,
      rn: 0,
    };
  }
  return {
    videos,
    events,
    snapshots,
    range: '30d',
    includeImports: false,
    now: NOW,
    onRange() {},
    onImports() {},
    onReview() {},
    ...over,
  };
}

test('an empty history shows a friendly message and no charts', () => {
  const root = renderStats(sampleCtx({ events: [], snapshots: {} }));
  assert.match(textOf(root), /No history yet/);
  assert.equal(find(root, (n) => n.tagName === 'svg').length, 0);
});

test('the Stats tab renders tiles, both charts, insights and breakdowns without broken numbers', () => {
  const root = renderStats(sampleCtx());
  const text = textOf(root);

  // summary tiles
  const tiles = Object.fromEntries(
    find(root, (n) => hasClass(n, 'st-tile')).map((t) => {
      const [label, value] = t.children.map(textOf);
      return [label.trim(), value.trim()];
    }),
  );
  assert.equal(tiles.Added, '12');
  assert.equal(tiles.Finished, '5');
  assert.equal(tiles['Thrown away'], '1');
  assert.equal(tiles['Waiting now'], '12');
  assert.equal(tiles['Finish rate'], '42%'); // 5 of 12

  // two charts (bars + line), a legend with both series, and a table version of each
  assert.equal(find(root, (n) => n.tagName === 'svg').length, 2);
  assert.match(text, /Added vs finished/);
  assert.match(text, /List size over time/);
  assert.equal(find(root, (n) => n.tagName === 'details').length, 2);
  assert.equal(find(root, (n) => hasClass(n, 'sw-added') || hasClass(n, 'sw-finished')).length >= 2, true);

  // one bar group per day over 30 days: 30 hover areas, and bars only where there is something to draw
  const bars = find(root, (n) => n.tagName === 'path' && (hasClass(n, 'bar-added') || hasClass(n, 'bar-finished')));
  assert.ok(bars.length > 0);
  assert.equal(find(root, (n) => hasClass(n, 'hit')).length, 30);

  // the insights panel and breakdown cards are there
  assert.ok(find(root, (n) => hasClass(n, 'st-insight')).length >= 6);
  assert.match(text, /Finish rate by length/);
  assert.match(text, /Channels you save most/);
  assert.match(text, /When you finish/);

  // nothing in the drawing or the text is NaN / undefined / Infinity
  walk(root, (n) => {
    for (const [k, v] of Object.entries(n.attrs || {})) assert.ok(!/NaN|undefined|Infinity/.test(v), `${n.tagName} ${k}="${v}"`);
  });
  assert.ok(!/NaN|undefined|Infinity/.test(text), 'text contains a broken number');
});

test('every time range renders, and the bar step follows the range', () => {
  for (const range of ['7d', '30d', '90d', '1y', 'all']) {
    const root = renderStats(sampleCtx({ range }));
    assert.equal(find(root, (n) => n.tagName === 'svg').length >= 1, true, range);
  }
  const hits = (range) => find(renderStats(sampleCtx({ range })), (n) => hasClass(n, 'hit')).length;
  assert.equal(hits('7d'), 7); // one bar group per day
  assert.ok(hits('90d') <= 14); // 90 days are drawn as weeks
});

test('range buttons and the imports checkbox call back', () => {
  const calls = [];
  const root = renderStats(sampleCtx({ onRange: (k) => calls.push(`range:${k}`), onImports: (v) => calls.push(`imports:${v}`) }));
  const week = find(root, (n) => n.tagName === 'button' && n._text === '7 days')[0];
  week.listeners.click[0]();
  const box = find(root, (n) => n.tagName === 'input')[0];
  box.listeners.change[0]({ target: { checked: true } });
  assert.deepEqual(calls, ['range:7d', 'imports:true']);
});

test('the "Review in list" button is offered for old unfinished videos', () => {
  const ctx = sampleCtx();
  ctx.videos.push({ id: 'oldvideo0001', list: 'watchLater', addedAt: NOW - 200 * DAY, title: 'old', tags: [] });
  let cutoff = null;
  ctx.onReview = (c) => (cutoff = c);
  const root = renderStats(ctx);
  const button = find(root, (n) => n.tagName === 'button' && n._text === 'Review in list')[0];
  assert.ok(button);
  button.listeners.click[0]();
  assert.equal(cutoff, NOW - 90 * DAY);
});

test('the line chart asks for more history when there is only one day', () => {
  const root = renderStats(sampleCtx({ snapshots: {} }));
  // only today's live point exists, so no line chart yet
  assert.equal(find(root, (n) => n.tagName === 'svg').length, 1);
  assert.match(textOf(root), /Needs at least two days of history/);
});

test('niceScale gives whole-number axes with at most 4 steps', () => {
  assert.deepEqual(niceScale(0), { step: 1, top: 1 });
  assert.deepEqual(niceScale(3), { step: 1, top: 3 });
  assert.deepEqual(niceScale(7), { step: 2, top: 8 });
  assert.deepEqual(niceScale(23), { step: 10, top: 30 });
  assert.deepEqual(niceScale(100), { step: 50, top: 100 });
  for (const max of [1, 2, 5, 9, 13, 47, 99, 480, 1234]) {
    const { step, top } = niceScale(max);
    assert.ok(Number.isInteger(step) && top >= max && top / step <= 4, `max ${max}`);
  }
});

test('barPath: rounded tip, square foot, nothing for an empty bar', () => {
  assert.equal(barPath(0, 10, 12, 0), '');
  const d = barPath(10, 20, 12, 30, 4);
  assert.match(d, /^M10,50L10,24Q10,20 14,20L18,20Q22,20 22,24L22,50Z$/); // square at y=50 (baseline), curved at y=20
  assert.match(barPath(0, 10, 12, 2, 4), /^M0,12L0,12/); // a very short bar shrinks its radius instead of overshooting
});
