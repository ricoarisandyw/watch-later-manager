import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInsights } from '../lib/insights.js';

const DAY = 86_400_000;
const NOW = new Date(2025, 5, 20, 12).getTime(); // Friday 20 June 2025, noon
const ev = (type, id, t, extra = {}) => ({ t, type, id, ...extra });
const vid = (id, over = {}) => ({ id, list: 'watchLater', addedAt: NOW - DAY, ...over });
const by = (list, key) => list.find((i) => i.key === key);

test('with no history every insight admits there is not enough data (no invented numbers)', () => {
  const list = buildInsights({ videos: [vid('a')], events: [], now: NOW });
  assert.equal(by(list, 'pace').tone, 'muted');
  assert.match(by(list, 'pace').text, /Not enough activity/);
  assert.equal(by(list, 'eta'), undefined);
  assert.equal(by(list, 'wait').tone, 'muted');
  assert.equal(by(list, 'time').tone, 'muted');
  assert.equal(by(list, 'streak').tone, 'muted');
  assert.equal(by(list, 'rewatch'), undefined);
  for (const i of list) assert.ok(!/NaN|Infinity|undefined/.test(i.text), i.text);
});

test('pace and ETA: finishing more than you add clears the list', () => {
  // logging began 14 days ago: 2 added, 4 finished in 2 weeks -> 1/week added, 2/week finished
  const start = NOW - 14 * DAY;
  const events = [
    ev('added', 'a', start, { source: 'rightclick', durationSec: 3600 }),
    ev('added', 'b', start + 1000, { source: 'rightclick', durationSec: 3600 }),
    ev('finished', 'w', start + DAY, { durationSec: 1800 }),
    ev('finished', 'x', start + 2 * DAY, { durationSec: 1800 }),
    ev('finished', 'y', start + 3 * DAY, { durationSec: 1800 }),
    ev('finished', 'z', start + 4 * DAY, { durationSec: 1800 }),
  ];
  const videos = Array.from({ length: 10 }, (_, i) => vid(`v${i}`));
  const list = buildInsights({ videos, events, now: NOW });
  assert.match(by(list, 'pace').text, /In the last 2 weeks you added 1 and finished 2 videos per week/);
  assert.equal(by(list, 'eta').tone, 'good');
  // 10 videos / (2 - 1 per week) = 10 weeks = 70 days, which is worded in months from 60 days up
  assert.match(by(list, 'eta').text, /10 videos would be cleared in about 2 months/);
  assert.match(by(list, 'hours').text, /add about 1h of video and finish about 1h/); // 3600s/2wk and 7200s/2wk
});

test('pace and ETA: adding more than you finish says the list is growing', () => {
  const start = NOW - 14 * DAY;
  const events = [
    ...Array.from({ length: 8 }, (_, i) => ev('added', `a${i}`, start + i * 1000, { source: 'rightclick' })),
    ev('finished', 'a0', start + DAY),
  ];
  const list = buildInsights({ videos: [vid('a1'), vid('a2')], events, now: NOW });
  assert.equal(by(list, 'eta').tone, 'warn');
  assert.match(by(list, 'eta').text, /grows by about 3\.5 videos each week/); // 4/week added - 0.5/week finished
});

test('nothing finished yet, and an empty list, are said plainly', () => {
  const start = NOW - 10 * DAY;
  const added = [ev('added', 'a', start, { source: 'rightclick' })];
  const stalled = buildInsights({ videos: [vid('a')], events: added, now: NOW });
  assert.match(by(stalled, 'eta').text, /haven't finished a video/);
  const events = [...added, ev('finished', 'a', start + DAY)];
  const empty = buildInsights({ videos: [], events, now: NOW });
  assert.match(by(empty, 'eta').text, /list is empty/);
});

test('graveyard counts old unfinished videos and offers to review them', () => {
  const old = (id) => vid(id, { addedAt: NOW - 120 * DAY });
  const events = [ev('finished', 'done', NOW - 5 * DAY)];
  const list = buildInsights({ videos: [old('o1'), old('o2'), old('done'), vid('new')], events, now: NOW });
  const g = by(list, 'graveyard');
  assert.equal(g.tone, 'warn');
  assert.match(g.text, /^2 videos in your list have been waiting more than 90 days/);
  assert.equal(g.action.id, 'review');
  assert.equal(g.action.cutoff, NOW - 90 * DAY);
  const none = by(buildInsights({ videos: [vid('new')], events: [], now: NOW }), 'graveyard');
  assert.equal(none.tone, 'good');
  const one = by(buildInsights({ videos: [old('solo')], events: [], now: NOW }), 'graveyard');
  assert.match(one.text, /^1 video in your list has been waiting .* never finished it\./);
});

test('wait time needs at least 3 finished videos', () => {
  const t = NOW - 30 * DAY;
  const mk = (n) => [
    ...Array.from({ length: n }, (_, i) => ev('added', `v${i}`, t, { source: 'rightclick' })),
    ...Array.from({ length: n }, (_, i) => ev('finished', `v${i}`, t + (i + 1) * 2 * DAY)),
  ];
  assert.equal(by(buildInsights({ videos: [], events: mk(2), now: NOW }), 'wait').tone, 'muted');
  const three = by(buildInsights({ videos: [], events: mk(3), now: NOW }), 'wait');
  assert.match(three.text, /median of 4 days before you finish them \(average 4 days\)/);
});

test('length and channel insights compare best and worst, and need enough videos', () => {
  const t = NOW - 40 * DAY;
  const add = (id, durationSec, channel) => ev('added', id, t, { source: 'rightclick', durationSec, channel });
  const events = [
    add('s1', 300, 'Alpha'), add('s2', 300, 'Alpha'), add('s3', 300, 'Alpha'), // 3 short, all finished
    add('l1', 4000, 'Beta'), add('l2', 4000, 'Beta'), add('l3', 4000, 'Beta'), // 3 long, none finished
    ev('finished', 's1', t + DAY), ev('finished', 's2', t + DAY), ev('finished', 's3', t + DAY),
  ];
  const list = buildInsights({ videos: [], events, now: NOW });
  assert.match(by(list, 'length').text, /finish 100% of your “Under 10 min” videos but only 0% of your “Over 1 hour” ones/);
  assert.match(by(list, 'channel').text, /most videos from Alpha \(3 of 3\) and fewest from Beta \(0 of 3\)/);

  const few = buildInsights({ videos: [], events: events.slice(0, 2), now: NOW });
  assert.equal(by(few, 'length').tone, 'muted');
  assert.equal(by(few, 'channel'), undefined);
});

test('best time and streak', () => {
  const finishAt = (id, d, h) => ev('finished', id, new Date(2025, 5, d, h).getTime());
  const events = [
    finishAt('a', 16, 21), // Monday evenings
    finishAt('b', 17, 21),
    finishAt('c', 18, 21),
    finishAt('d', 19, 21),
    finishAt('e', 9, 21), // Monday, 9 June
  ];
  const list = buildInsights({ videos: [], events, now: NOW });
  assert.match(by(list, 'time').text, /Most of your finishes happen on Mondays, around 21:00/);
  assert.equal(by(list, 'streak').tone, 'good'); // 16th..19th, and "yesterday" (19th) keeps it alive
  assert.match(by(list, 'streak').text, /Current streak: 4 days in a row \(longest ever: 4\)/);
});

test('rewatch share appears only after 3 finished videos', () => {
  const t = NOW - 5 * DAY;
  const fin = (id) => ev('finished', id, t);
  const events = [fin('a'), fin('b'), fin('c'), fin('d'), ev('moved', 'a', t + 1, { to: 'rewatch' })];
  assert.match(by(buildInsights({ videos: [], events, now: NOW }), 'rewatch').text, /25% .* \(1 of 4\)/);
  assert.equal(by(buildInsights({ videos: [], events: events.slice(0, 2), now: NOW }), 'rewatch'), undefined);
});
