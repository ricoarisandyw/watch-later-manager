import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LISTS,
  createRecord,
  mergeImport,
  normalizeRecord,
  normalizeTag,
  parseDuration,
  parseRelativeAge,
  parseVideoId,
  parseViews,
} from '../lib/model.js';

const ID = 'dQw4w9WgXcQ';

test('parseVideoId reads the common link shapes', () => {
  assert.equal(parseVideoId(`https://www.youtube.com/watch?v=${ID}`), ID);
  assert.equal(parseVideoId(`https://www.youtube.com/watch?v=${ID}&list=PL123&t=30s`), ID);
  assert.equal(parseVideoId(`https://youtu.be/${ID}?si=abc`), ID);
  assert.equal(parseVideoId(`https://www.youtube.com/shorts/${ID}`), ID);
  assert.equal(parseVideoId(`https://m.youtube.com/watch?v=${ID}`), ID);
  assert.equal(parseVideoId(`/watch?v=${ID}`), ID);
});

test('parseVideoId rejects things that are not a video', () => {
  assert.equal(parseVideoId('https://www.youtube.com/'), null);
  assert.equal(parseVideoId('https://www.youtube.com/@somechannel'), null);
  assert.equal(parseVideoId('https://www.youtube.com/playlist?list=WL'), null);
  assert.equal(parseVideoId('https://example.com/watch?v=' + ID), null);
  assert.equal(parseVideoId('https://www.youtube.com/watch?v=short'), null);
  assert.equal(parseVideoId(''), null);
  assert.equal(parseVideoId(undefined), null);
});

test('parseDuration', () => {
  assert.equal(parseDuration('12:34'), 754);
  assert.equal(parseDuration('1:02:03'), 3723);
  assert.equal(parseDuration(' 0:45 '), 45);
  assert.equal(parseDuration('LIVE'), null);
  assert.equal(parseDuration(undefined), null);
});

test('parseViews', () => {
  assert.equal(parseViews('1.2M'), 1200000);
  assert.equal(parseViews('3.4K views'), 3400);
  assert.equal(parseViews('12,345 views'), 12345);
  assert.equal(parseViews('2B'), 2e9);
  assert.equal(parseViews('No views'), 0);
  assert.equal(parseViews('hello'), null);
});

test('normalizeTag cleans up what you type', () => {
  assert.equal(normalizeTag('  #Learn   JS '), 'learn js');
  assert.equal(normalizeTag(''), '');
  assert.equal(normalizeTag(null), '');
  assert.equal(normalizeTag('x'.repeat(50)).length, 30);
});

test('createRecord fills safe defaults, even with missing info', () => {
  const rec = createRecord({ id: ID, title: 'Hi' }, 1000);
  assert.equal(rec.list, LISTS.WATCH_LATER);
  assert.equal(rec.durationSec, null);
  assert.equal(rec.views, null);
  assert.equal(rec.channel, '');
  assert.deepEqual(rec.tags, []);
  assert.equal(rec.addedAt, 1000);
  assert.match(rec.thumbnail, new RegExp(ID));
  assert.equal(createRecord({ id: 'nope' }), null);
});

test('mergeImport adds new videos, keeps existing ones, merges tags', () => {
  const existing = {
    [ID]: createRecord({ id: ID, title: 'Mine', tags: ['a'] }, 1),
  };
  existing[ID].list = LISTS.REWATCH;
  const result = mergeImport(
    existing,
    [
      { id: ID, title: 'Other title', tags: ['b'], list: LISTS.WATCH_LATER },
      { id: 'abcdefghijk', title: 'New one', list: LISTS.REWATCH },
      { id: 'bad' },
      null,
    ],
    5,
  );
  assert.equal(result.added, 1);
  assert.equal(result.already, 1);
  assert.equal(result.invalid, 2);
  assert.equal(result.videos[ID].title, 'Mine');
  assert.equal(result.videos[ID].list, LISTS.REWATCH);
  assert.deepEqual(result.videos[ID].tags, ['a', 'b']);
  assert.equal(result.videos.abcdefghijk.list, LISTS.REWATCH);
});

test('a moved video keeps its tags through export -> import', () => {
  const rec = createRecord({ id: ID, title: 'T', tags: ['learn'] }, 1);
  rec.list = LISTS.REWATCH;
  const back = mergeImport({}, JSON.parse(JSON.stringify([rec])));
  assert.deepEqual(back.videos[ID], rec);
});

test('parseRelativeAge turns "2 years ago" into an estimated date (middle of the range)', () => {
  const now = Date.UTC(2025, 5, 15);
  const day = 86_400_000;
  assert.equal(parseRelativeAge('1.2M views • 2 years ago', now), now - 2.5 * 365 * day);
  assert.equal(parseRelativeAge('3 weeks ago', now), now - 3.5 * 7 * day);
  assert.equal(parseRelativeAge('1 day ago', now), now - 1.5 * day);
  assert.equal(parseRelativeAge('5 hours ago', now), now - 5.5 * 3_600_000);
  assert.equal(parseRelativeAge('Streamed 4 months ago', now), now - 4.5 * 30 * day);
  assert.equal(parseRelativeAge('12K views', now), null);
  assert.equal(parseRelativeAge('', now), null);
  assert.equal(parseRelativeAge(undefined, now), null);
});

test('publishedApprox only survives when there is a date', () => {
  assert.equal(normalizeRecord({ id: ID, publishedAt: 5, publishedApprox: true }).publishedApprox, true);
  assert.equal(normalizeRecord({ id: ID, publishedAt: null, publishedApprox: true }).publishedApprox, false);
  assert.equal(normalizeRecord({ id: ID, publishedAt: 5 }).publishedApprox, false);
});

test('re-importing fills gaps in videos we already have, but never overwrites what is known', () => {
  const old = createRecord({ id: ID, title: 'Old', durationSec: 100, views: null, channel: '' }, 1);
  const result = mergeImport(
    { [ID]: old },
    [{ id: ID, durationSec: 999, views: 50, channel: 'Chan', publishedAt: 123, publishedApprox: true }],
  );
  const rec = result.videos[ID];
  assert.equal(rec.durationSec, 100); // kept
  assert.equal(rec.views, 50); // filled
  assert.equal(rec.channel, 'Chan'); // filled
  assert.equal(rec.publishedAt, 123);
  assert.equal(rec.publishedApprox, true);

  const exact = { ...rec, publishedAt: 777, publishedApprox: false };
  const again = mergeImport({ [ID]: exact }, [{ id: ID, publishedAt: 123, publishedApprox: true }]);
  assert.equal(again.videos[ID].publishedAt, 777); // an exact date is never replaced by an estimate
  assert.equal(again.videos[ID].publishedApprox, false);
});
