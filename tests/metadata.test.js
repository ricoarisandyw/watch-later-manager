import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonAfter, fetchVideoMeta, fallbackMeta, parsePlayerResponse } from '../lib/metadata.js';

const player = {
  videoDetails: {
    videoId: 'dQw4w9WgXcQ',
    title: 'A title with } and { and "quotes" inside',
    author: 'Some Channel',
    lengthSeconds: '212',
    viewCount: '1234567',
  },
  microformat: { playerMicroformatRenderer: { publishDate: '2020-01-02T03:04:05-07:00' } },
};

const html = `<html><script>var a = 1; var ytInitialPlayerResponse = ${JSON.stringify(player)};var b = {x:1};</script></html>`;

test('extractJsonAfter survives braces inside strings', () => {
  assert.deepEqual(extractJsonAfter(html, 'ytInitialPlayerResponse = '), player);
  assert.equal(extractJsonAfter('<html></html>', 'ytInitialPlayerResponse = '), null);
  assert.equal(extractJsonAfter('ytInitialPlayerResponse = {broken', 'ytInitialPlayerResponse = '), null);
});

test('parsePlayerResponse reads the fields we need', () => {
  assert.deepEqual(parsePlayerResponse(player), {
    id: 'dQw4w9WgXcQ',
    title: player.videoDetails.title,
    channel: 'Some Channel',
    durationSec: 212,
    views: 1234567,
    publishedAt: Date.parse('2020-01-02T03:04:05-07:00'),
  });
  assert.equal(parsePlayerResponse({}), null);
  assert.equal(parsePlayerResponse(null), null);
});

test('live streams (length 0) and missing views become null', () => {
  const meta = parsePlayerResponse({
    videoDetails: { videoId: 'dQw4w9WgXcQ', title: 'Live', lengthSeconds: '0' },
  });
  assert.equal(meta.durationSec, null);
  assert.equal(meta.views, null);
  assert.equal(meta.publishedAt, null);
});

test('fetchVideoMeta stamps when the details were read', async () => {
  const ok = async () => ({ ok: true, text: async () => html });
  const meta = await fetchVideoMeta('dQw4w9WgXcQ', ok);
  assert.ok(meta.detailsAt > 0);
  assert.equal(meta.publishedAt, Date.parse('2020-01-02T03:04:05-07:00'));
});

test('fetchVideoMeta works with a fake fetch and fails clearly when the page has no details', async () => {
  const ok = async () => ({ ok: true, text: async () => html });
  assert.equal((await fetchVideoMeta('dQw4w9WgXcQ', ok)).durationSec, 212);

  const empty = async () => ({ ok: true, text: async () => '<html></html>' });
  await assert.rejects(() => fetchVideoMeta('dQw4w9WgXcQ', empty), /No video details/);

  const down = async () => ({ ok: false, status: 429, text: async () => '' });
  await assert.rejects(() => fetchVideoMeta('dQw4w9WgXcQ', down), /429/);
});

test('fallbackMeta keeps what the card showed', () => {
  const meta = fallbackMeta('dQw4w9WgXcQ', { title: 'Card title', channel: 'Card channel' });
  assert.equal(meta.title, 'Card title');
  assert.equal(meta.channel, 'Card channel');
  assert.equal(meta.durationSec, null);
  assert.equal(fallbackMeta('dQw4w9WgXcQ', null).title, 'dQw4w9WgXcQ');
});
