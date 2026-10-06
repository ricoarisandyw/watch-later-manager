import test from 'node:test';
import assert from 'node:assert/strict';

// A tiny in-memory stand-in for chrome.storage.local, so the real storage code can run in Node.
function installChrome() {
  const data = {};
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          if (keys == null) return structuredClone(data);
          const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys);
          const out = {};
          for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
          return out;
        },
        async set(obj) {
          for (const [k, v] of Object.entries(obj)) data[k] = structuredClone(v);
        },
        async remove(keys) {
          for (const k of [].concat(keys)) delete data[k];
        },
      },
    },
  };
  return data;
}

const store = await import('../lib/storage.js');
const { effectiveEvents } = await import('../lib/events.js');

const ID = (n) => `video${String(n).padStart(6, '0')}`; // 11 characters
const meta = (n, extra = {}) => ({ id: ID(n), title: `Video ${n}`, channel: 'Chan', durationSec: 600, ...extra });
const types = async () => (await store.listEvents()).map((e) => e.type);

test.beforeEach(() => {
  installChrome();
  store.__test.setEventLimit(20000);
});

test('saving a video logs one "added" event and updates today\'s snapshot', async () => {
  await store.saveVideo(meta(1));
  await store.saveVideo(meta(1)); // duplicate: nothing new
  const events = await store.listEvents();
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'added');
  assert.equal(events[0].source, 'rightclick');
  assert.equal(events[0].channel, 'Chan');
  assert.equal(events[0].durationSec, 600);
  const snaps = Object.values(await store.getSnapshots());
  assert.deepEqual(snaps, [{ n: 1, sec: 600, rn: 0 }]);
});

test('remove, move and tag each log what happened', async () => {
  await store.saveVideo(meta(1));
  await store.saveVideo(meta(2));
  await store.moveVideo(ID(1), 'rewatch');
  await store.moveVideo(ID(1), 'rewatch'); // already there: no event
  await store.setTags(ID(1), ['learn', 'js']);
  await store.setTags(ID(1), ['learn', 'js', 'css']); // only the new tag is logged
  await store.removeVideo(ID(2), 'done');
  await store.removeVideo(ID(2), 'done'); // already gone: no event

  const events = await store.listEvents();
  assert.deepEqual(
    events.map((e) => e.type),
    ['added', 'added', 'moved', 'tagged', 'tagged', 'tagged', 'removed'],
  );
  assert.equal(events.find((e) => e.type === 'moved').to, 'rewatch');
  assert.deepEqual(
    events.filter((e) => e.type === 'tagged').map((e) => e.tag),
    ['learn', 'js', 'css'],
  );
  assert.equal(events.find((e) => e.type === 'removed').reason, 'done');
});

test('bulk actions log one event per video, in one go', async () => {
  for (let i = 1; i <= 300; i++) await store.saveVideo(meta(i));
  const ids = Array.from({ length: 300 }, (_, i) => ID(i + 1));
  assert.equal(await store.moveMany(ids, 'rewatch'), 300);
  assert.equal(await store.addTagMany(ids, 'Bulk'), 300);
  assert.equal(await store.addTagMany(ids, 'bulk'), 0); // everyone has it already
  assert.equal(await store.removeMany(ids), 300);

  const events = await store.listEvents();
  const count = (type) => events.filter((e) => e.type === type).length;
  assert.equal(count('added'), 300);
  assert.equal(count('moved'), 300);
  assert.equal(count('tagged'), 300);
  assert.equal(count('removed'), 300);
  assert.ok(events.filter((e) => e.type === 'removed').every((e) => e.reason === 'bulk'));
});

test('Undo logs "restored", which cancels the removal in the stats', async () => {
  await store.saveVideo(meta(1));
  const record = await store.getVideo(ID(1));
  await store.removeVideo(ID(1));
  await store.putVideo(record); // Undo
  assert.deepEqual(await types(), ['added', 'removed', 'restored']);
  assert.deepEqual(
    effectiveEvents(await store.listEvents()).map((e) => e.type),
    ['added'],
  );

  await store.removeMany([ID(1)]);
  await store.putMany([record]); // bulk Undo
  assert.equal(effectiveEvents(await store.listEvents()).filter((e) => e.type === 'removed').length, 0);
});

test('import logs only the videos that are new, as "import"', async () => {
  await store.saveVideo(meta(1));
  const result = await store.importVideos([meta(1), meta(2), meta(3)]);
  assert.equal(result.added, 2);
  const imports = (await store.listEvents()).filter((e) => e.source === 'import');
  assert.deepEqual(imports.map((e) => e.id).sort(), [ID(2), ID(3)]);
});

test('with "Keep history" off nothing is logged; turning it back on resumes', async () => {
  await store.setSettings({ keepHistory: false });
  await store.saveVideo(meta(1));
  await store.removeVideo(ID(1));
  await store.logEvents([{ t: Date.now(), type: 'finished', id: ID(1) }]);
  assert.equal((await store.listEvents()).length, 0);
  assert.deepEqual(await store.getSnapshots(), {});
  assert.equal((await store.historyInfo()).keep, false);

  await store.setSettings({ keepHistory: true });
  await store.saveVideo(meta(2));
  assert.deepEqual(await types(), ['added']);
});

test('backfill turns existing videos into "added" events once, and spots imported runs', async () => {
  const data = globalThis.chrome.storage.local;
  const base = new Date(2025, 4, 1, 10).getTime();
  const videos = {};
  // 6 videos saved exactly 1s apart look like an import; 2 others were saved by hand
  for (let i = 1; i <= 6; i++) {
    videos[ID(i)] = { id: ID(i), title: 't', channel: 'c', addedAt: base - i * 1000, list: 'watchLater', tags: [] };
  }
  videos[ID(7)] = { id: ID(7), title: 't', channel: 'c', addedAt: base + 86_400_000, list: 'watchLater', tags: [] };
  videos[ID(8)] = { id: ID(8), title: 't', channel: 'c', addedAt: base + 3 * 86_400_000 + 77, list: 'rewatch', tags: [] };
  await data.set({ videos });

  assert.equal(await store.ensureBackfill(), true);
  assert.equal(await store.ensureBackfill(), false); // second call does nothing
  const events = await store.listEvents();
  assert.equal(events.length, 8);
  assert.equal(events.filter((e) => e.source === 'import').length, 6);
  assert.equal(events.filter((e) => e.source === 'backfill').length, 2);
  assert.equal(events.find((e) => e.id === ID(7)).t, base + 86_400_000); // dated when you saved it
});

test('backfill skips videos that already have an "added" event', async () => {
  await store.saveVideo(meta(1)); // logged normally
  await store.ensureBackfill();
  assert.equal((await store.listEvents()).filter((e) => e.type === 'added').length, 1);
});

test('Clear history empties everything and is not rebuilt from your videos', async () => {
  await store.saveVideo(meta(1));
  await store.clearHistory();
  assert.equal((await store.listEvents()).length, 0);
  assert.deepEqual(await store.getSnapshots(), {});
  assert.equal(await store.ensureBackfill(), false);
  assert.equal((await store.listEvents()).length, 0);
  assert.equal((await store.getVideo(ID(1))).id, ID(1)); // your videos are untouched
  await store.saveVideo(meta(2)); // and logging carries on
  assert.deepEqual(await types(), ['added']);
});

test('the history is capped, and the oldest events go first', async () => {
  store.__test.setEventLimit(10);
  const base = new Date(2025, 0, 5, 12).getTime();
  const month = 31 * 86_400_000;
  // 4 events in January, 4 in February, 4 in March, logged in order
  for (let m = 0; m < 3; m++) {
    await store.logEvents(
      Array.from({ length: 4 }, (_, i) => ({ t: base + m * month + i * 1000, type: 'finished', id: ID(m * 4 + i) })),
    );
  }
  const events = await store.listEvents();
  assert.equal(events.length, 10);
  assert.equal((await store.historyInfo()).count, 10);
  assert.equal(events[0].id, ID(2)); // the two oldest are gone
  const data = await globalThis.chrome.storage.local.get(null);
  assert.deepEqual(
    Object.keys(data).filter((k) => k.startsWith('events:')).sort(),
    ['events:2025-01', 'events:2025-02', 'events:2025-03'],
  );

  // one more month pushes a whole month out and removes its storage key
  await store.logEvents(
    Array.from({ length: 4 }, (_, i) => ({ t: base + 3 * month + i * 1000, type: 'finished', id: ID(100 + i) })),
  );
  const after = await store.listEvents();
  assert.equal(after.length, 10);
  const keys = Object.keys(await globalThis.chrome.storage.local.get(null)).filter((k) => k.startsWith('events:'));
  assert.ok(!keys.includes('events:2025-01'));
});

test('export, clear and import brings the history back without doubling it', async () => {
  await store.saveVideo(meta(1));
  await store.saveVideo(meta(2));
  await store.moveVideo(ID(1), 'rewatch');
  await store.logEvents([{ t: Date.now(), type: 'finished', id: ID(1) }]);
  const file = await store.exportJson();
  const parsed = JSON.parse(file);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.events.length, 4);

  await store.clearAll();
  await store.clearHistory();
  assert.equal((await store.listVideos()).length, 0);

  const result = await store.importJson(file);
  assert.equal(result.added, 2);
  assert.equal(result.events, 4);
  const events = await store.listEvents();
  assert.equal(events.length, 4);
  assert.equal(events.filter((e) => e.source === 'import').length, 0); // the file's own history, not new "imports"

  const again = await store.importJson(file); // importing the same file twice adds no history
  assert.equal(again.events, 0);
  assert.equal((await store.listEvents()).length, 4);
});

test('an old export file without history still imports, logging the videos as "import"', async () => {
  const old = JSON.stringify({ app: 'my-watch-later', version: 1, videos: [meta(1), meta(2)] });
  const result = await store.importJson(old);
  assert.equal(result.added, 2);
  assert.equal(result.events, 0);
  assert.deepEqual(
    (await store.listEvents()).map((e) => e.source),
    ['import', 'import'],
  );
  await assert.rejects(() => store.importJson('not json'), /not valid JSON/);
  await assert.rejects(() => store.importJson('{"hello":1}'), /No videos/);
});

test('clearing all videos logs a removal for each, with reason "clear"', async () => {
  await store.saveVideo(meta(1));
  await store.saveVideo(meta(2));
  await store.clearAll();
  const removed = (await store.listEvents()).filter((e) => e.type === 'removed');
  assert.equal(removed.length, 2);
  assert.ok(removed.every((e) => e.reason === 'clear'));
  assert.deepEqual(Object.values(await store.getSnapshots()), [{ n: 0, sec: 0, rn: 0 }]);
});

test('a failing history write never stops a video from being saved', async () => {
  const realSet = globalThis.chrome.storage.local.set;
  globalThis.chrome.storage.local.set = async (obj) => {
    if (Object.keys(obj).some((k) => k.startsWith('events:') || k === 'historyMeta')) throw new Error('disk full');
    return realSet(obj);
  };
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const { duplicate } = await store.saveVideo(meta(1));
    assert.equal(duplicate, false);
    assert.equal((await store.getVideo(ID(1))).id, ID(1));
  } finally {
    console.warn = originalWarn;
  }
});
