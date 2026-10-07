import test from 'node:test';
import assert from 'node:assert/strict';
import { SAVE_EVERY_MS, matchesLength, progressUpdate, timeLeftSec, withProgress } from '../lib/progress.js';
import { createProgressTracker } from '../content/progress.js';

test('progressUpdate: save, clear or ignore', () => {
  assert.deepEqual(progressUpdate(125.4, 1800), { type: 'save', sec: 125 });
  assert.deepEqual(progressUpdate(2, 1800), { type: 'ignore' }); // a fresh page load starts at 0
  assert.deepEqual(progressUpdate(1796, 1800), { type: 'clear' }); // within 5s of the end
  assert.deepEqual(progressUpdate(1800, 1800), { type: 'clear' });
  assert.deepEqual(progressUpdate(100, Infinity), { type: 'ignore' }); // live stream
  assert.deepEqual(progressUpdate(100, NaN), { type: 'ignore' }); // not loaded yet
  assert.deepEqual(progressUpdate(10, 15), { type: 'ignore' }); // too short to track
});

test('matchesLength tolerates 2 seconds and accepts an unknown saved length', () => {
  assert.equal(matchesLength(600, 601), true);
  assert.equal(matchesLength(600, 900), false);
  assert.equal(matchesLength(600, null), true);
});

test('timeLeftSec', () => {
  assert.equal(timeLeftSec(1800, null), 1800);
  assert.equal(timeLeftSec(1800, 1320), 480);
  assert.equal(timeLeftSec(1800, 5000), 0); // never negative
  assert.equal(timeLeftSec(null, 100), null); // unknown stays unknown
});

test('withProgress adds fields to copies and ignores bad entries', () => {
  const list = [{ id: 'a', durationSec: 600 }, { id: 'b', durationSec: 600 }, { id: 'c', durationSec: 600 }];
  const out = withProgress(list, { a: { sec: 100 }, b: { sec: 'x' } });
  assert.deepEqual(out.map((v) => [v.progressSec, v.timeLeftSec]), [[100, 500], [null, 600], [null, 600]]);
  assert.equal(list[0].progressSec, undefined);
});

function setup(record = { id: 'a', durationSec: 1800 }) {
  const saved = [];
  let t = 1_000_000;
  const track = createProgressTracker({
    getRecord: (id) => (id === 'a' ? record : undefined),
    save: (id, sec) => saved.push([id, sec]),
    now: () => t,
  });
  return { saved, track, advance: (ms) => (t += ms) };
}
const player = (currentTime, duration = 1800) => ({ currentTime, duration });

test('tracker writes at most every 15 seconds, but pause (force) writes at once', () => {
  const { saved, track, advance } = setup();
  track('a', player(60));
  track('a', player(61)); // too soon
  advance(SAVE_EVERY_MS);
  track('a', player(76));
  track('a', player(80), true); // pause
  assert.deepEqual(saved, [['a', 60], ['a', 76], ['a', 80]]);
});

test('tracker skips an unchanged position and videos that are not saved', () => {
  const { saved, track, advance } = setup();
  track('a', player(60));
  advance(SAVE_EVERY_MS);
  track('a', player(60)); // paused in place
  track('zzz', player(60)); // not saved
  assert.deepEqual(saved, [['a', 60]]);
});

test('tracker forgets the position once, when the video ends', () => {
  const { saved, track } = setup();
  track('a', player(900));
  track('a', player(1797));
  track('a', player(1800), true);
  assert.deepEqual(saved, [['a', 900], ['a', null]]);
});

test('tracker ignores a stale player that still shows the previous video', () => {
  const { saved, track } = setup({ id: 'a', durationSec: 1800 });
  track('a', player(300, 600)); // the player still has the old 10-minute video
  assert.deepEqual(saved, []);
});
