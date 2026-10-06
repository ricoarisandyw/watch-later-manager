import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT,
  backlogSeries,
  bestTimes,
  bucketStart,
  clearEta,
  completionBreakdown,
  dayKey,
  dayStart,
  detectImportRuns,
  effectiveEvents,
  finishRate,
  formatSpan,
  graveyard,
  monthStart,
  nextBucket,
  paceStats,
  parseDayKey,
  pickStep,
  rangeBounds,
  rewatchRate,
  sanitizeEvent,
  seriesByPeriod,
  streak,
  summarize,
  timeToFinish,
  weekStart,
} from '../lib/events.js';

// All dates are built in local time (like the code does), so these tests pass in any time zone.
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const DAY = 86_400_000;
const ev = (type, id, t, extra = {}) => ({ t, type, id, ...extra });

test('week starts on Monday, month on the 1st, day keys round-trip', () => {
  assert.equal(weekStart(at(2025, 6, 18, 15, 30)), at(2025, 6, 16, 0)); // Wednesday
  assert.equal(weekStart(at(2025, 6, 22, 23, 59)), at(2025, 6, 16, 0)); // Sunday belongs to the week before
  assert.equal(weekStart(at(2025, 6, 16, 0, 0)), at(2025, 6, 16, 0));
  assert.equal(monthStart(at(2025, 6, 18)), at(2025, 6, 1, 0));
  assert.equal(dayStart(at(2025, 6, 18, 23, 59)), at(2025, 6, 18, 0));
  assert.equal(dayKey(at(2025, 1, 5)), '2025-01-05');
  assert.equal(parseDayKey('2025-01-05'), at(2025, 1, 5, 0));
});

test('buckets step correctly over month and year boundaries', () => {
  assert.equal(nextBucket(at(2025, 12, 29, 0), 'week'), at(2026, 1, 5, 0));
  assert.equal(nextBucket(at(2025, 12, 1, 0), 'month'), at(2026, 1, 1, 0));
  assert.equal(nextBucket(at(2025, 2, 28, 0), 'day'), at(2025, 3, 1, 0));
  assert.equal(bucketStart(at(2025, 12, 31, 20), 'month'), at(2025, 12, 1, 0));
});

test('pickStep and rangeBounds', () => {
  assert.equal(pickStep(30), 'day');
  assert.equal(pickStep(90), 'week');
  assert.equal(pickStep(365), 'week');
  assert.equal(pickStep(900), 'month');
  const now = at(2025, 6, 18, 12);
  const week = rangeBounds('7d', [], now);
  assert.equal(week.from, at(2025, 6, 12, 0)); // today and the 6 days before
  assert.equal(week.step, 'day');
  assert.equal(rangeBounds('1y', [], now).step, 'week');
  const all = rangeBounds('all', [ev('added', 'a', at(2023, 1, 3, 9))], now);
  assert.equal(all.from, at(2023, 1, 3, 0));
  assert.equal(all.step, 'month');
  assert.equal(rangeBounds('all', [], now).step, 'day'); // no history yet
});

test('an Undo cancels the removal it undid, and only that one', () => {
  const t = at(2025, 6, 10);
  const events = [
    ev('added', 'a', t),
    ev('removed', 'a', t + 1000, { reason: 'manual' }),
    ev('restored', 'a', t + 2000),
    ev('removed', 'b', t + 3000, { reason: 'manual' }),
    ev('removed', 'c', t + 4000, { reason: 'bulk' }),
    ev('restored', 'c', t + 5000),
    ev('removed', 'c', t + 6000, { reason: 'bulk' }), // removed again after the Undo: counts
  ];
  const kept = effectiveEvents(events);
  assert.deepEqual(
    kept.map((e) => `${e.type}:${e.id}`),
    ['added:a', 'removed:b', 'removed:c'],
  );
  assert.equal(kept[2].t, t + 6000);
});

const T = at(2025, 6, 10, 10);
const scenario = [
  ev('added', 'a', T, { source: 'rightclick' }),
  ev('added', 'b', T + 1, { source: 'rightclick' }),
  ev('added', 'c', T + 2, { source: 'import' }),
  ev('finished', 'a', T + 10),
  ev('moved', 'a', T + 25, { to: 'rewatch' }),
  ev('finished', 'a', T + 20), // finishing the same video twice counts once
  ev('removed', 'a', T + 30, { reason: 'done' }),
  ev('removed', 'b', T + 40, { reason: 'manual' }),
];

test('summarize counts added, finished, and removed (done vs thrown away)', () => {
  const opts = { from: T - 1000, to: T + 1_000_000 };
  assert.deepEqual(summarize(scenario, opts), {
    added: 2, // the import is left out
    finished: 1,
    removedDone: 1,
    removedUnwatched: 1, // b was removed without ever being finished
    toRewatch: 1,
  });
  assert.equal(summarize(scenario, { ...opts, includeImports: true }).added, 3);
  assert.equal(summarize(scenario, { from: T + 100, to: T + 1_000_000 }).added, 0); // range is respected
});

test('a video you finished and later removed by hand is not "thrown away unwatched"', () => {
  const events = [
    ev('added', 'a', T),
    ev('finished', 'a', T + 5),
    ev('removed', 'a', T + 9, { reason: 'manual' }),
  ];
  assert.equal(summarize(events, { from: 0, to: T + 100 }).removedUnwatched, 0);
});

test('finishRate looks at all time and can never pass 100%', () => {
  assert.deepEqual(finishRate(scenario), { added: 2, finished: 1, rate: 0.5 });
  assert.deepEqual(finishRate(scenario, true), { added: 3, finished: 1, rate: 1 / 3 });
  assert.deepEqual(finishRate([]), { added: 0, finished: 0, rate: null });
  // finishing a video that was never "added" in the log (before logging) does not push it over 100%
  assert.equal(finishRate([ev('finished', 'z', T), ev('added', 'a', T)]).rate, 0);
});

test('seriesByPeriod fills quiet days with zeros and counts unique finishes per period', () => {
  const d1 = at(2025, 6, 10, 9);
  const d3 = at(2025, 6, 12, 9);
  const events = [
    ev('added', 'a', d1, { source: 'rightclick' }),
    ev('added', 'b', d1 + 1000, { source: 'rightclick' }),
    ev('added', 'imp', d1 + 2000, { source: 'import' }),
    ev('finished', 'a', d1 + 5000),
    ev('finished', 'a', d1 + 6000), // same video, same day: once
    ev('added', 'c', d3, { source: 'rightclick' }),
    ev('finished', 'b', d3 + 1000),
    ev('finished', 'c', d3 + 2000),
  ];
  const bounds = { from: at(2025, 6, 10, 0), to: at(2025, 6, 12, 23), step: 'day' };
  const series = seriesByPeriod(events, bounds);
  assert.deepEqual(
    series.map((p) => [p.added, p.finished]),
    [
      [2, 1],
      [0, 0],
      [1, 2],
    ],
  );
  assert.equal(series[0].start, at(2025, 6, 10, 0));
  assert.equal(seriesByPeriod(events, { ...bounds, includeImports: true })[0].added, 3);
});

test('seriesByPeriod by month crosses a year boundary', () => {
  const events = [
    ev('added', 'a', at(2025, 12, 31, 23), { source: 'rightclick' }),
    ev('added', 'b', at(2026, 1, 1, 0, 30), { source: 'rightclick' }),
  ];
  const series = seriesByPeriod(events, { from: at(2025, 11, 15, 0), to: at(2026, 2, 3, 0), step: 'month' });
  assert.deepEqual(
    series.map((p) => p.added),
    [0, 1, 1, 0],
  );
});

test('backlogSeries picks snapshots in range, in order', () => {
  const snaps = {
    '2025-06-12': { n: 30, sec: 100 },
    '2025-06-10': { n: 28, sec: 90 },
    '2025-05-01': { n: 1, sec: 1 },
  };
  const out = backlogSeries(snaps, { from: at(2025, 6, 1, 0), to: at(2025, 6, 30, 0) });
  assert.deepEqual(
    out.map((p) => p.n),
    [28, 30],
  );
});

test('paceStats only counts real activity, over the time logging has existed', () => {
  const now = at(2025, 6, 20, 12);
  const events = [
    ev('added', 'old', now - 90 * DAY, { source: 'backfill' }), // history from before logging: ignored
    ev('added', 'imp', now - 8 * DAY, { source: 'import' }), // ignored
    ev('added', 'a', now - 10 * DAY, { source: 'rightclick', durationSec: 3600 }),
    ev('added', 'b', now - 9 * DAY, { source: 'rightclick', durationSec: 1800 }),
    ev('finished', 'a', now - 5 * DAY, { durationSec: 3600 }),
    ev('finished', 'a', now - 4 * DAY, { durationSec: 3600 }), // twice: once
  ];
  const pace = paceStats(events, now, 28);
  assert.ok(Math.abs(pace.sampleDays - 10) < 1e-9); // logging began 10 days ago
  assert.ok(Math.abs(pace.addedPerWeek - 2 / (10 / 7)) < 1e-9);
  assert.ok(Math.abs(pace.finishedPerWeek - 1 / (10 / 7)) < 1e-9);
  assert.ok(Math.abs(pace.secAddedPerWeek - 5400 / (10 / 7)) < 1e-6);
  assert.ok(Math.abs(pace.secFinishedPerWeek - 3600 / (10 / 7)) < 1e-6);
  // never less than a week of sample, so one busy day doesn't look like a trend
  assert.equal(paceStats([ev('added', 'x', now - DAY, { source: 'rightclick' })], now).sampleDays, 7);
});

test('clearEta: clearing, growing, stalled, empty', () => {
  assert.deepEqual(clearEta({ backlog: 10, addedPerWeek: 1, finishedPerWeek: 3 }), { status: 'clearing', weeks: 5 });
  assert.deepEqual(clearEta({ backlog: 10, addedPerWeek: 3, finishedPerWeek: 1 }), { status: 'growing', perWeek: 2 });
  assert.deepEqual(clearEta({ backlog: 10, addedPerWeek: 3, finishedPerWeek: 3 }), { status: 'growing', perWeek: 0 });
  assert.deepEqual(clearEta({ backlog: 10, addedPerWeek: 3, finishedPerWeek: 0 }), { status: 'stalled' });
  assert.deepEqual(clearEta({ backlog: 0, addedPerWeek: 3, finishedPerWeek: 0 }), { status: 'empty' });
});

test('formatSpan', () => {
  assert.equal(formatSpan(0.5), 'less than a day');
  assert.equal(formatSpan(1), '1 day');
  assert.equal(formatSpan(3), '3 days');
  assert.equal(formatSpan(21), '3 weeks');
  assert.equal(formatSpan(90), '3 months');
  assert.equal(formatSpan(800), '2.2 years');
});

test('timeToFinish: median and average days from saving to first finishing', () => {
  const t = at(2025, 1, 1, 0);
  const events = [
    ev('added', 'a', t),
    ev('added', 'b', t),
    ev('added', 'c', t),
    ev('added', 'd', t + 20 * DAY),
    ev('finished', 'a', t + 2 * DAY),
    ev('finished', 'a', t + 3 * DAY), // later finish of the same video is ignored
    ev('finished', 'b', t + 4 * DAY),
    ev('finished', 'c', t + 10 * DAY),
    ev('finished', 'd', t + 5 * DAY), // finished "before" it was added: ignored
    ev('finished', 'ghost', t + 5 * DAY), // never added in the log: ignored
  ];
  const r = timeToFinish(events);
  assert.equal(r.count, 3);
  assert.equal(r.medianDays, 4);
  assert.ok(Math.abs(r.avgDays - 16 / 3) < 1e-9);
  assert.deepEqual(timeToFinish([]), { count: 0, medianDays: null, avgDays: null });
});

test('graveyard: old, still waiting, never finished', () => {
  const now = at(2025, 6, 20);
  const v = (id, ageDays, list = 'watchLater') => ({ id, list, addedAt: now - ageDays * DAY });
  const videos = [v('old1', 100), v('old2', 200), v('seen', 150), v('fresh', 10), v('rw', 300, 'rewatch')];
  const g = graveyard(videos, [ev('finished', 'seen', now - 50 * DAY)], now, 90);
  assert.equal(g.count, 2);
  assert.deepEqual(
    g.oldest.map((x) => x.id),
    ['old2', 'old1'],
  );
});

test('completionBreakdown by length and by channel', () => {
  const t = at(2025, 3, 1);
  const events = [
    ev('added', 'a', t, { source: 'rightclick', durationSec: 300, channel: 'X' }),
    ev('added', 'b', t, { source: 'rightclick', durationSec: 300, channel: 'X' }),
    ev('added', 'c', t, { source: 'rightclick', durationSec: 1200, channel: 'Y' }),
    ev('added', 'd', t, { source: 'rightclick', durationSec: null, channel: '' }),
    ev('added', 'imp', t, { source: 'import', durationSec: 300, channel: 'X' }),
    ev('finished', 'a', t + 1),
    ev('finished', 'c', t + 1),
    ev('finished', 'imp', t + 1),
  ];
  assert.deepEqual(completionBreakdown(events, { by: 'length' }), [
    { label: 'Under 10 min', added: 2, finished: 1, rate: 0.5 },
    { label: '10–30 min', added: 1, finished: 1, rate: 1 },
    { label: 'Unknown length', added: 1, finished: 0, rate: 0 },
  ]);
  const channels = completionBreakdown(events, { by: 'channel' });
  assert.deepEqual(
    channels.map((r) => [r.label, r.added, r.finished]),
    [
      ['X', 2, 1],
      ['Unknown', 1, 0],
      ['Y', 1, 1],
    ],
  );
  assert.equal(completionBreakdown(events, { by: 'channel', includeImports: true })[0].added, 3);
});

test('bestTimes counts finishes by weekday (Monday first) and hour', () => {
  const events = [
    ev('finished', 'a', at(2025, 6, 16, 21)), // Monday 21:00
    ev('finished', 'b', at(2025, 6, 23, 21, 30)), // Monday 21:30
    ev('finished', 'c', at(2025, 6, 17, 8)), // Tuesday 08:00
    ev('added', 'd', at(2025, 6, 18, 3)), // not a finish
  ];
  const r = bestTimes(events);
  assert.deepEqual(r.byWeekday, [2, 1, 0, 0, 0, 0, 0]);
  assert.equal(r.byHour[21], 2);
  assert.equal(r.byHour[8], 1);
  assert.equal(r.total, 3);
});

test('streak: current survives until the end of today, longest is remembered', () => {
  const now = at(2025, 6, 18, 12);
  const finishOn = (d, h = 20) => ev('finished', `v${d}-${h}`, at(2025, 6, d, h));
  // 15, 16, 17 in a row (today, the 18th, has none yet), plus a lone day on the 10th
  const events = [finishOn(10), finishOn(15), finishOn(16), finishOn(16, 9), finishOn(17)];
  assert.deepEqual(streak(events, now), { current: 3, longest: 3 });
  assert.deepEqual(streak([...events, finishOn(18, 8)], now), { current: 4, longest: 4 });
  assert.deepEqual(streak([finishOn(10)], now), { current: 0, longest: 1 }); // streak is broken
  assert.deepEqual(streak([], now), { current: 0, longest: 0 });
});

test('rewatchRate', () => {
  const events = [
    ev('finished', 'a', 1),
    ev('finished', 'b', 2),
    ev('moved', 'a', 3, { to: 'rewatch' }),
    ev('moved', 'z', 3, { to: 'rewatch' }), // moved but never finished: not counted
  ];
  assert.deepEqual(rewatchRate(events), { finished: 2, toRewatch: 1, rate: 0.5 });
  assert.deepEqual(rewatchRate([]), { finished: 0, toRewatch: 0, rate: null });
});

test('detectImportRuns finds videos stamped one second apart, and leaves the rest', () => {
  const base = at(2025, 5, 1, 10);
  const run = Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, addedAt: base - i * 1000 }));
  const short = Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, addedAt: base + DAY - i * 1000 }));
  const lone = [
    { id: 'l1', addedAt: base + 5 * DAY },
    { id: 'l2', addedAt: base + 6 * DAY + 1234 },
  ];
  const found = detectImportRuns([...run, ...short, ...lone]);
  assert.deepEqual([...found].sort(), run.map((v) => v.id).sort());
  assert.equal(detectImportRuns([]).size, 0);
});

test('sanitizeEvent keeps known fields only and rejects junk', () => {
  assert.deepEqual(sanitizeEvent({ t: 5, type: EVENT.ADDED, id: 'a', source: 'import', evil: 'x' }), {
    t: 5,
    type: 'added',
    id: 'a',
    source: 'import',
  });
  assert.equal(sanitizeEvent({ t: 'x', type: 'added', id: 'a' }), null);
  assert.equal(sanitizeEvent({ t: 5, type: 'nope', id: 'a' }), null);
  assert.equal(sanitizeEvent({ t: 5, type: 'added' }), null);
  assert.equal(sanitizeEvent(null), null);
});
