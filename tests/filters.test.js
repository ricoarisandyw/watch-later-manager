import test from 'node:test';
import assert from 'node:assert/strict';
import { LISTS } from '../lib/model.js';
import { withProgress } from '../lib/progress.js';
import {
  applyFilters,
  customRange,
  dataCoverage,
  formatDays,
  formatDuration,
  formatHours,
  formatTotalTime,
  formatViews,
  pickRandom,
  sortVideos,
  totalDuration,
  uniqueChannels,
  uniqueTags,
} from '../lib/filters.js';

const v = (id, over = {}) => ({
  id,
  title: `Video ${id}`,
  channel: 'Chan A',
  durationSec: 300,
  views: 5000,
  addedAt: 1,
  list: LISTS.WATCH_LATER,
  tags: [],
  ...over,
});

const videos = [
  v('a', { durationSec: 300, views: 5_000, channel: 'Chan A', tags: ['learn'], addedAt: 3 }),
  v('b', { durationSec: 1200, views: 50_000, channel: 'Chan B', tags: ['learn', 'js'], addedAt: 2 }),
  v('c', { durationSec: 2400, views: 500_000, channel: 'Chan B', addedAt: 1 }),
  v('d', { durationSec: 7200, views: 5_000_000, channel: 'Chan C', list: LISTS.REWATCH, addedAt: 4 }),
  v('e', { durationSec: null, views: null, channel: 'Chan C', title: 'Mystery', addedAt: 5 }),
];

const ids = (list) => list.map((x) => x.id);

test('filter by list', () => {
  assert.deepEqual(ids(applyFilters(videos, { list: LISTS.REWATCH })), ['d']);
});

test('filter by duration buckets (min included, max excluded)', () => {
  assert.deepEqual(ids(applyFilters(videos, { duration: 'short' })), ['a']);
  assert.deepEqual(ids(applyFilters(videos, { duration: 'medium' })), ['b']);
  assert.deepEqual(ids(applyFilters(videos, { duration: 'long' })), ['c']);
  assert.deepEqual(ids(applyFilters(videos, { duration: 'xlong' })), ['d']);
  const edge = [v('x', { durationSec: 600 })];
  assert.deepEqual(ids(applyFilters(edge, { duration: 'short' })), []);
  assert.deepEqual(ids(applyFilters(edge, { duration: 'medium' })), ['x']);
});

test('filter by views buckets', () => {
  assert.deepEqual(ids(applyFilters(videos, { views: 'low' })), ['a']);
  assert.deepEqual(ids(applyFilters(videos, { views: 'mid' })), ['b']);
  assert.deepEqual(ids(applyFilters(videos, { views: 'high' })), ['c']);
  assert.deepEqual(ids(applyFilters(videos, { views: 'huge' })), ['d']);
});

test('filter by channel and tag', () => {
  assert.deepEqual(ids(applyFilters(videos, { channel: 'Chan B' })), ['b', 'c']);
  assert.deepEqual(ids(applyFilters(videos, { tag: 'learn' })), ['a', 'b']);
  assert.deepEqual(ids(applyFilters(videos, { tag: 'nope' })), []);
});

test('search looks at title, channel and tags', () => {
  assert.deepEqual(ids(applyFilters(videos, { query: 'mystery' })), ['e']);
  assert.deepEqual(ids(applyFilters(videos, { query: 'chan c' })), ['d', 'e']);
  assert.deepEqual(ids(applyFilters(videos, { query: 'JS' })), ['b']);
});

test('combined filters all apply, and empty filters give everything back', () => {
  assert.deepEqual(
    ids(applyFilters(videos, { channel: 'Chan B', tag: 'learn', duration: 'medium' })),
    ['b'],
  );
  assert.deepEqual(ids(applyFilters(videos, { channel: 'Chan A', tag: 'js' })), []);
  assert.equal(applyFilters(videos, {}).length, videos.length);
  assert.equal(applyFilters(videos, { query: '  ', duration: '', channel: '' }).length, 5);
});

test('videos with unknown duration or views are left out of those filters only', () => {
  assert.ok(!ids(applyFilters(videos, { duration: 'short' })).includes('e'));
  assert.ok(ids(applyFilters(videos, {})).includes('e'));
});

test('sorting, with missing numbers always last', () => {
  assert.deepEqual(ids(sortVideos(videos, 'added-desc')), ['e', 'd', 'a', 'b', 'c']);
  assert.deepEqual(ids(sortVideos(videos, 'added-asc')), ['c', 'b', 'a', 'd', 'e']);
  assert.deepEqual(ids(sortVideos(videos, 'duration-asc')), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(ids(sortVideos(videos, 'duration-desc')), ['d', 'c', 'b', 'a', 'e']);
  assert.deepEqual(ids(sortVideos(videos, 'views-desc')), ['d', 'c', 'b', 'a', 'e']);
  assert.equal(sortVideos(videos, 'title-asc')[0].title, 'Mystery');
});

test('unique channels and tags with counts', () => {
  assert.deepEqual(uniqueChannels(videos), [
    { name: 'Chan A', count: 1 },
    { name: 'Chan B', count: 2 },
    { name: 'Chan C', count: 2 },
  ]);
  assert.deepEqual(uniqueTags(videos), [
    { name: 'js', count: 1 },
    { name: 'learn', count: 2 },
  ]);
});

test('formatDuration and formatViews', () => {
  assert.equal(formatDuration(65), '1:05');
  assert.equal(formatDuration(3723), '1:02:03');
  assert.equal(formatDuration(null), '');
  assert.equal(formatViews(1), '1 view');
  assert.equal(formatViews(950), '950 views');
  assert.equal(formatViews(12_345), '12.3K views');
  assert.equal(formatViews(1_200_000), '1.2M views');
  assert.equal(formatViews(250_000), '250K views');
  assert.equal(formatViews(null), '');
});

// ---------- custom ranges ----------

test('customRange: duration is typed in minutes', () => {
  assert.deepEqual(customRange('duration', '5', '20'), { min: 300, max: 1200 });
  assert.deepEqual(customRange('duration', '1.5', ''), { min: 90, max: null });
  assert.deepEqual(customRange('duration', '', '45'), { min: null, max: 2700 });
  assert.equal(customRange('duration', '', ''), null);
  assert.equal(customRange('duration', 'abc', '-3'), null);
  assert.deepEqual(customRange('duration', '20', '5'), { min: 300, max: 1200 }); // swapped
});

test('customRange: views accept 10k / 1.5M / 2,000', () => {
  assert.deepEqual(customRange('views', '10k', '1.5M'), { min: 10_000, max: 1_500_000 });
  assert.deepEqual(customRange('views', '2,000', ''), { min: 2000, max: null });
  assert.equal(customRange('views', 'lots', ''), null);
});

test('customRange: dates cover the whole "to" day', () => {
  const r = customRange('published', '2024-03-01', '2024-03-31');
  assert.equal(r.min, new Date(2024, 2, 1).getTime());
  assert.equal(r.max, new Date(2024, 3, 1).getTime() - 1);
  assert.equal(customRange('saved', 'not a date', ''), null);
  const swapped = customRange('saved', '2024-03-31', '2024-03-01');
  assert.equal(swapped.min, r.min);
  assert.equal(swapped.max, r.max);
});

test('custom duration range includes both ends', () => {
  const list = [v('a', { durationSec: 300 }), v('b', { durationSec: 1200 }), v('c', { durationSec: 1201 })];
  const range = customRange('duration', '5', '20');
  assert.deepEqual(ids(applyFilters(list, { duration: range })), ['a', 'b']);
});

test('custom views range, with one end left open', () => {
  assert.deepEqual(ids(applyFilters(videos, { views: customRange('views', '50k', '') })), ['b', 'c', 'd']);
  assert.deepEqual(ids(applyFilters(videos, { views: customRange('views', '', '5000') })), ['a']);
});

test('published and saved date filters', () => {
  const now = new Date(2025, 5, 15).getTime();
  const day = 86_400_000;
  const dated = [
    v('new', { publishedAt: now - 2 * day, addedAt: now - 1 * day }),
    v('mid', { publishedAt: now - 60 * day, addedAt: now - 40 * day }),
    v('old', { publishedAt: now - 800 * day, addedAt: now - 500 * day }),
    v('unknown', { publishedAt: null, addedAt: now - 3 * day }),
  ];
  assert.deepEqual(ids(applyFilters(dated, { published: '7d' }, now)), ['new']);
  assert.deepEqual(ids(applyFilters(dated, { published: '90d' }, now)), ['new', 'mid']);
  assert.deepEqual(ids(applyFilters(dated, { published: 'old' }, now)), ['old']);
  assert.deepEqual(ids(applyFilters(dated, { saved: '30d' }, now)), ['new', 'unknown']);
  assert.deepEqual(ids(applyFilters(dated, { saved: 'old' }, now)), ['old']);
  // unknown published date never matches an active published filter, but is fine otherwise
  assert.ok(!ids(applyFilters(dated, { published: '365d' }, now)).includes('unknown'));
  assert.equal(applyFilters(dated, {}, now).length, 4);

  const range = customRange('published', '2025-04-01', '2025-04-30');
  assert.deepEqual(ids(applyFilters(dated, { published: range }, now)), ['mid']);
});

test('sorting by published date puts unknown dates last', () => {
  const list = [v('a', { publishedAt: 10 }), v('b', { publishedAt: null }), v('c', { publishedAt: 30 })];
  assert.deepEqual(ids(sortVideos(list, 'published-desc')), ['c', 'a', 'b']);
  assert.deepEqual(ids(sortVideos(list, 'published-asc')), ['a', 'c', 'b']);
});

// ---------- time to finish ----------

test('totalDuration adds up lengths and counts the unknown ones', () => {
  const t = totalDuration(videos); // 300 + 1200 + 2400 + 7200, one unknown
  assert.equal(t.seconds, 11100);
  assert.equal(t.known, 4);
  assert.equal(t.unknown, 1);
  assert.equal(totalDuration(videos, 2).seconds, 5550);
  assert.equal(totalDuration(videos, 0).seconds, 11100); // bad speed falls back to 1x
  assert.deepEqual(totalDuration([]), { seconds: 0, unknown: 0, known: 0 });
});

test('formatTotalTime and formatHours', () => {
  assert.equal(formatTotalTime(30_300), '8h 25m');
  assert.equal(formatTotalTime(2700), '45m');
  assert.equal(formatTotalTime(7200), '2h');
  assert.equal(formatTotalTime(45), '45s');
  assert.equal(formatTotalTime(3599), '1h'); // rounds to the nearest minute
  assert.equal(formatTotalTime(180_000), '2d 2h');
  assert.equal(formatHours(30_300), '8.4 hours');
  assert.equal(formatHours(3600), '1 hour');
});

test('formatTotalTime splits into months, days, hours and minutes', () => {
  const H = 3600;
  assert.equal(formatTotalTime(176 * H), '7d 8h'); // 176 hours
  assert.equal(formatTotalTime(23 * H + 59 * 60), '23h 59m');
  assert.equal(formatTotalTime(24 * H), '1d');
  assert.equal(formatTotalTime(48 * H), '2d');
  assert.equal(formatTotalTime(30 * 24 * H), '1mo');
  assert.equal(formatTotalTime((30 * 24 + 5) * H), '1mo 5h'); // zero units are skipped
  assert.equal(formatTotalTime((62 * 24 + 12) * H + 5 * 60), '2mo 2d 12h 5m');
  assert.equal(formatTotalTime(24 * H - 20), '1d'); // rounds to the nearest minute, never "24h"
});

test('formatDays and formatHours give the same total as one number', () => {
  assert.equal(formatHours(176 * 3600), '176 hours');
  assert.equal(formatDays(176 * 3600), '7.3 days');
  assert.equal(formatDays(86400), '1 day');
  assert.equal(formatDays(86400 * 45), '45 days');
});

test('dataCoverage counts what exists and what is missing', () => {
  const list = [
    v('a', { publishedAt: 10, publishedApprox: false }),
    v('b', { publishedAt: 20, publishedApprox: true, views: null }),
    v('c', { publishedAt: null, durationSec: null, channel: '' }),
  ];
  assert.deepEqual(dataCoverage(list), {
    total: 3,
    length: { have: 2, missing: 1 },
    views: { have: 2, missing: 1 },
    channel: { have: 2, missing: 1 },
    published: { exact: 1, approx: 1, missing: 1 },
  });
  assert.equal(dataCoverage([]).total, 0);
  // old records saved before the published date existed have no such field at all
  assert.equal(dataCoverage([{ id: 'x', channel: 'c', durationSec: 1, views: 1 }]).published.missing, 1);
});

test('sorting by title Z-A and by channel (no channel always last)', () => {
  const list = [
    v('a', { title: 'Banana', channel: 'Zed' }),
    v('b', { title: 'Apple', channel: 'Amy' }),
    v('c', { title: 'Cherry', channel: '' }),
    v('d', { title: 'Avocado', channel: 'Amy' }),
  ];
  assert.deepEqual(ids(sortVideos(list, 'title-desc')), ['c', 'a', 'd', 'b']);
  assert.deepEqual(ids(sortVideos(list, 'channel-asc')), ['b', 'd', 'a', 'c']);
  assert.deepEqual(ids(sortVideos(list, 'channel-desc')), ['a', 'b', 'd', 'c']); // same channel: title A-Z
});

test('time left: filter, sort and total use what is left of a started video', () => {
  const started = withProgress(
    [
      v('p', { durationSec: 1800 }), // not started: 30 min left
      v('q', { durationSec: 1800 }), // 22 min in: 8 min left
      v('r', { durationSec: 300 }), // 5 min, not started
      v('s', { durationSec: null }), // unknown length
    ],
    { q: { sec: 1320, at: 1 } },
  );
  assert.deepEqual(ids(applyFilters(started, { timeLeft: 'left10' })), ['q', 'r']);
  assert.deepEqual(ids(applyFilters(started, { timeLeft: 'left5' })), []); // 5 min is not under 5 min
  assert.deepEqual(ids(applyFilters(started, { timeLeft: 'left60' })), ['p', 'q', 'r']);
  assert.deepEqual(ids(applyFilters(started, { timeLeft: customRange('timeLeft', '6', '8') })), ['q']);
  assert.deepEqual(ids(sortVideos(started, 'left-asc')), ['r', 'q', 'p', 's']);
  assert.deepEqual(ids(sortVideos(started, 'left-desc')), ['p', 'q', 'r', 's']);
  assert.equal(totalDuration(started).seconds, 1800 + 480 + 300);
  assert.equal(totalDuration(started).unknown, 1);
});

test('pickRandom picks from the list, never the one just shown, and copes with tiny lists', () => {
  assert.equal(pickRandom([], null), null);
  assert.equal(pickRandom([videos[0]], 'a').id, 'a'); // the only one left may repeat
  const three = videos.slice(0, 3);
  assert.equal(pickRandom(three, null, () => 0).id, 'a');
  assert.equal(pickRandom(three, null, () => 0.99999).id, 'c');
  for (const r of [0, 0.3, 0.5, 0.99999]) assert.notEqual(pickRandom(three, 'b', () => r).id, 'b');
  assert.equal(pickRandom(three, null, () => 1).id, 'c'); // a random() of exactly 1 stays in range
});
