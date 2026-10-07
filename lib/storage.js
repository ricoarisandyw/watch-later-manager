import { LISTS, createRecord, mergeImport, normalizeRecord, normalizeTag } from './model.js';
import {
  EVENT,
  MAX_EVENTS,
  dayKey,
  detectImportRuns,
  eventFor,
  eventKey,
  makeEvent,
  sanitizeEvent,
} from './events.js';

const VIDEOS_KEY = 'videos';
const SETTINGS_KEY = 'settings';
const META_KEY = 'historyMeta'; // { count, months: ['2026-09', ...], backfilled }
const SNAPSHOTS_KEY = 'snapshots'; // { '2026-10-06': { n, sec, rn } }
const PROGRESS_KEY = 'progress'; // { videoId: { sec, at } } how far you got; kept apart from the videos so a write every few seconds doesn't touch them
const SHARD_PREFIX = 'events:'; // one list of events per month, e.g. 'events:2026-10'

export const DEFAULT_SETTINGS = Object.freeze({
  overrideWatchLater: true, // show the dialog instead of YouTube's own Watch Later page
  autoOpenHome: true, // show the dialog when youtube.com home loads
  promptOnFinish: true, // Should Rewatch / Remove prompt on saved videos (when opened, and again when finished)
  playbackSpeed: 1, // used for the "time to finish" total
  view: 'cards', // 'cards' or 'table'
  promptMinimized: false, // the Should Rewatch / Remove prompt starts as a small pill
  keepHistory: true, // write the history log used by the Stats tab
});

// Writes run one after another so two quick changes can't overwrite each other.
let queue = Promise.resolve();
function serial(task) {
  const run = queue.then(task);
  queue = run.catch(() => {});
  return run;
}

async function readMap() {
  const data = await chrome.storage.local.get(VIDEOS_KEY);
  return data[VIDEOS_KEY] || {};
}

function writeMap(map) {
  return chrome.storage.local.set({ [VIDEOS_KEY]: map });
}

// ---------- history: one log line per action, plus a daily snapshot ----------

let eventLimit = MAX_EVENTS;
export const __test = {
  setEventLimit(n) {
    eventLimit = n;
  },
};

const monthOf = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

async function readMeta() {
  const data = await chrome.storage.local.get(META_KEY);
  return { count: 0, months: [], backfilled: false, ...(data[META_KEY] || {}) };
}

async function readAllEvents() {
  const meta = await readMeta();
  if (!meta.months.length) return [];
  const keys = meta.months.map((m) => SHARD_PREFIX + m);
  const data = await chrome.storage.local.get(keys);
  return keys.flatMap((k) => data[k] || []);
}

// Adds events to their month's list. Keeps at most `eventLimit` events, dropping the oldest first.
// Callers decide whether history is switched on.
async function appendRaw(list) {
  if (!list.length) return;
  const meta = await readMeta();
  const byMonth = new Map();
  for (const e of list) {
    const month = monthOf(e.t);
    byMonth.set(month, [...(byMonth.get(month) || []), e]);
  }
  const existing = await chrome.storage.local.get([...byMonth.keys()].map((m) => SHARD_PREFIX + m));
  const toSet = {};
  for (const [month, events] of byMonth) {
    const key = SHARD_PREFIX + month;
    toSet[key] = [...(existing[key] || []), ...events].sort((a, b) => a.t - b.t); // oldest first, so trimming drops the oldest
    if (!meta.months.includes(month)) meta.months.push(month);
  }
  meta.months.sort();
  meta.count += list.length;

  const toRemove = [];
  while (meta.count > eventLimit && meta.months.length) {
    const key = SHARD_PREFIX + meta.months[0];
    const shard = toSet[key] || (await chrome.storage.local.get(key))[key] || [];
    const excess = meta.count - eventLimit;
    if (shard.length <= excess) {
      delete toSet[key];
      toRemove.push(key);
      meta.count -= shard.length;
      meta.months.shift();
    } else {
      toSet[key] = shard.slice(excess); // shards are kept oldest-first
      meta.count -= excess;
    }
  }
  await chrome.storage.local.set({ ...toSet, [META_KEY]: meta });
  if (toRemove.length) await chrome.storage.local.remove(toRemove);
}

async function updateSnapshot(map) {
  const videos = Object.values(map);
  const waiting = videos.filter((v) => v.list === LISTS.WATCH_LATER);
  const data = await chrome.storage.local.get(SNAPSHOTS_KEY);
  const snapshots = data[SNAPSHOTS_KEY] || {};
  snapshots[dayKey(Date.now())] = {
    n: waiting.length,
    sec: waiting.reduce((sum, v) => sum + (v.durationSec || 0), 0),
    rn: videos.length - waiting.length,
  };
  await chrome.storage.local.set({ [SNAPSHOTS_KEY]: snapshots });
}

// Saves the videos, then the history for that change. History must never break saving, so its
// errors are only logged.
async function commit(map, events = []) {
  await writeMap(map);
  try {
    if (!(await getSettings()).keepHistory) return;
    await appendRaw(events);
    await updateSnapshot(map);
  } catch (err) {
    console.warn('[My Watch Later] could not write history', err);
  }
}

// For things that happen outside a list change (a video finished, a prompt button pressed).
export async function logEvents(list) {
  if (!list.length || !(await getSettings()).keepHistory) return;
  await serial(() => appendRaw(list));
}

export async function listEvents() {
  return (await readAllEvents()).sort((a, b) => a.t - b.t);
}

export async function getSnapshots() {
  const data = await chrome.storage.local.get(SNAPSHOTS_KEY);
  return data[SNAPSHOTS_KEY] || {};
}

export async function historyInfo() {
  const meta = await readMeta();
  return { count: meta.count, keep: (await getSettings()).keepHistory };
}

// The first time history is on, turn the videos you already have into "added" events (at the date
// you saved them) so the charts don't start empty. Safe to call many times.
export function ensureBackfill() {
  return serial(async () => {
    if ((await readMeta()).backfilled) return false;
    if (!(await getSettings()).keepHistory) return false;
    const map = await readMap();
    const videos = Object.values(map);
    const known = new Set(
      (await readAllEvents()).filter((e) => e.type === EVENT.ADDED).map((e) => e.id),
    );
    const imported = detectImportRuns(videos);
    const events = videos
      .filter((v) => !known.has(v.id))
      .map((v) => eventFor(EVENT.ADDED, v, { source: imported.has(v.id) ? 'import' : 'backfill' }, v.addedAt));
    await appendRaw(events);
    await chrome.storage.local.set({ [META_KEY]: { ...(await readMeta()), backfilled: true } });
    await updateSnapshot(map);
    return true;
  });
}

// Deletes the whole history. It is not rebuilt from your current videos afterwards.
export function clearHistory() {
  return serial(async () => {
    const meta = await readMeta();
    await chrome.storage.local.remove([...meta.months.map((m) => SHARD_PREFIX + m), SNAPSHOTS_KEY]);
    await chrome.storage.local.set({ [META_KEY]: { count: 0, months: [], backfilled: true } });
  });
}

// Adds history from an exported file. Events we already have are skipped. Returns how many were new.
function mergeHistory(events, snapshots) {
  return serial(async () => {
    const seen = new Set((await readAllEvents()).map(eventKey));
    const fresh = [];
    for (const raw of events) {
      const e = sanitizeEvent(raw);
      if (e && !seen.has(eventKey(e))) {
        seen.add(eventKey(e));
        fresh.push(e);
      }
    }
    await appendRaw(fresh);
    const mine = await getSnapshots();
    const merged = { ...(snapshots && typeof snapshots === 'object' ? snapshots : {}), ...mine }; // ours win
    await chrome.storage.local.set({
      [SNAPSHOTS_KEY]: merged,
      [META_KEY]: { ...(await readMeta()), backfilled: true }, // the file already has the past
    });
    return fresh.length;
  });
}

// ---------- videos ----------

export async function getVideos() {
  return readMap();
}

export async function listVideos() {
  return Object.values(await readMap());
}

export async function getVideo(id) {
  return (await readMap())[id] || null;
}

// Returns { record, duplicate }. Saving a video twice keeps the first copy.
export function saveVideo(meta, source = 'rightclick') {
  return serial(async () => {
    const map = await readMap();
    if (map[meta.id]) return { record: map[meta.id], duplicate: true };
    const record = createRecord(meta);
    if (!record) throw new Error('Not a valid video');
    map[record.id] = record;
    await commit(map, [eventFor(EVENT.ADDED, record, { source })]);
    return { record, duplicate: false };
  });
}

// Puts a record back exactly as it was (used by Undo).
export function putVideo(record) {
  return serial(async () => {
    const clean = normalizeRecord(record);
    if (!clean) return;
    const map = await readMap();
    const wasThere = Boolean(map[clean.id]);
    map[clean.id] = clean;
    await commit(map, wasThere ? [] : [makeEvent(EVENT.RESTORED, clean.id)]);
  });
}

// reason: 'manual' (the Remove button), 'done' (Remove on the finish prompt), 'bulk', 'clear'
export function removeVideo(id, reason = 'manual') {
  return serial(async () => {
    const map = await readMap();
    const gone = map[id];
    delete map[id];
    await commit(map, gone ? [eventFor(EVENT.REMOVED, gone, { reason })] : []);
  });
}

export function moveVideo(id, list) {
  return serial(async () => {
    const map = await readMap();
    if (!map[id]) return;
    const to = list === LISTS.REWATCH ? LISTS.REWATCH : LISTS.WATCH_LATER;
    const changed = map[id].list !== to;
    map[id] = { ...map[id], list: to, movedAt: Date.now() };
    await commit(map, changed ? [eventFor(EVENT.MOVED, map[id], { to })] : []);
  });
}

// Fills in details read from YouTube. Numbers and dates are refreshed; title / channel only fill gaps.
export function patchVideo(id, details) {
  return serial(async () => {
    const map = await readMap();
    const current = map[id];
    if (!current) return;
    const next = { ...current };
    for (const key of ['durationSec', 'views', 'publishedAt', 'detailsAt']) {
      if (details[key] != null) next[key] = details[key];
    }
    if (details.publishedAt != null) next.publishedApprox = false; // an exact date replaces any estimate
    if (details.channel && !current.channel) next.channel = details.channel;
    if (details.title && (!current.title || current.title === id)) next.title = details.title;
    map[id] = next;
    await commit(map); // the list's total time may have changed, so the snapshot is refreshed
  });
}

export function setTags(id, tags) {
  return serial(async () => {
    const map = await readMap();
    if (!map[id]) return;
    const next = [...new Set(tags.map(normalizeTag).filter(Boolean))];
    const added = next.filter((t) => !map[id].tags.includes(t));
    map[id] = { ...map[id], tags: next };
    await commit(map, added.map((tag) => eventFor(EVENT.TAGGED, map[id], { tag })));
  });
}

// ---------- bulk versions: one read and one write, however many videos ----------

// Puts many records back exactly as they were (used by Undo).
export function putMany(records) {
  return serial(async () => {
    const map = await readMap();
    const events = [];
    for (const record of records) {
      const clean = normalizeRecord(record);
      if (!clean) continue;
      if (!map[clean.id]) events.push(makeEvent(EVENT.RESTORED, clean.id));
      map[clean.id] = clean;
    }
    await commit(map, events);
  });
}

// Returns how many videos were really removed.
export function removeMany(ids, reason = 'bulk') {
  return serial(async () => {
    const map = await readMap();
    const events = [];
    for (const id of ids) {
      if (map[id]) {
        events.push(eventFor(EVENT.REMOVED, map[id], { reason }));
        delete map[id];
      }
    }
    await commit(map, events);
    return events.length;
  });
}

export function moveMany(ids, list) {
  return serial(async () => {
    const map = await readMap();
    const target = list === LISTS.REWATCH ? LISTS.REWATCH : LISTS.WATCH_LATER;
    const now = Date.now();
    const events = [];
    for (const id of ids) {
      if (map[id] && map[id].list !== target) {
        map[id] = { ...map[id], list: target, movedAt: now };
        events.push(eventFor(EVENT.MOVED, map[id], { to: target }));
      }
    }
    await commit(map, events);
    return events.length;
  });
}

export function addTagMany(ids, tag) {
  return serial(async () => {
    const clean = normalizeTag(tag);
    if (!clean) return 0;
    const map = await readMap();
    const events = [];
    for (const id of ids) {
      if (map[id] && !map[id].tags.includes(clean)) {
        map[id] = { ...map[id], tags: [...map[id].tags, clean] };
        events.push(eventFor(EVENT.TAGGED, map[id], { tag: clean }));
      }
    }
    await commit(map, events);
    return events.length;
  });
}

export function removeTagMany(ids, tag) {
  return serial(async () => {
    const map = await readMap();
    let changed = 0;
    for (const id of ids) {
      if (map[id] && map[id].tags.includes(tag)) {
        map[id] = { ...map[id], tags: map[id].tags.filter((t) => t !== tag) };
        changed++;
      }
    }
    await commit(map);
    return changed;
  });
}

export function clearAll() {
  return serial(async () => {
    const map = await readMap();
    await commit(
      {},
      Object.values(map).map((v) => eventFor(EVENT.REMOVED, v, { reason: 'clear' })),
    );
  });
}

// Returns { added, already, invalid }. New videos are logged as "added" from 'import', unless
// `log` is false (a backup file that brings its own history).
export function importVideos(rawList, { log = true } = {}) {
  return serial(async () => {
    const before = await readMap();
    const result = mergeImport(before, rawList);
    const events = log
      ? Object.values(result.videos)
          .filter((v) => !before[v.id])
          .map((v) => eventFor(EVENT.ADDED, v, { source: 'import' }))
      : [];
    await commit(result.videos, events);
    return { added: result.added, already: result.already, invalid: result.invalid };
  });
}

// ---------- progress ----------

export async function getProgress() {
  const data = await chrome.storage.local.get(PROGRESS_KEY);
  return data[PROGRESS_KEY] || {};
}

// sec = seconds watched, or null to forget it. Only saved videos are remembered, and entries of videos
// that are gone are dropped on the way (not at removal, so Undo brings the position back).
export function setProgress(id, sec) {
  return serial(async () => {
    const data = await chrome.storage.local.get([VIDEOS_KEY, PROGRESS_KEY]);
    const videos = data[VIDEOS_KEY] || {};
    if (!videos[id]) return;
    const progress = {};
    for (const [key, entry] of Object.entries(data[PROGRESS_KEY] || {})) if (videos[key]) progress[key] = entry;
    if (sec == null) delete progress[id];
    else progress[id] = { sec, at: Date.now() };
    await chrome.storage.local.set({ [PROGRESS_KEY]: progress });
  });
}

// ---------- settings ----------

// Bump when a default changes and old saved copies of it should be dropped.
// 2: the default view became "cards" (earlier versions saved their old default, "table", along with other settings)
const SETTINGS_SCHEMA = 2;

export async function getSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  let stored = data[SETTINGS_KEY];
  if (stored && stored.schema !== SETTINGS_SCHEMA) {
    const { view, ...rest } = stored; // forget the old view once; it comes back from the new default
    stored = { ...rest, schema: SETTINGS_SCHEMA };
    await chrome.storage.local.set({ [SETTINGS_KEY]: stored });
  }
  return { ...DEFAULT_SETTINGS, ...(stored || {}) };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch, schema: SETTINGS_SCHEMA };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  return next;
}

// ---------- backup ----------

export async function exportJson() {
  return JSON.stringify(
    {
      app: 'my-watch-later',
      version: 2,
      exportedAt: new Date().toISOString(),
      videos: await listVideos(),
      events: await listEvents(),
      snapshots: await getSnapshots(),
    },
    null,
    2,
  );
}

// Accepts our export file (with or without history), or a plain array of videos.
// Returns { added, already, invalid, events } where `events` is how many history lines were new.
export async function importJson(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  const list = Array.isArray(data) ? data : data && data.videos;
  if (!Array.isArray(list)) throw new Error('No videos found in that file.');
  const hasHistory = !Array.isArray(data) && Array.isArray(data.events);
  const result = await importVideos(list, { log: !hasHistory });
  const events = hasHistory ? await mergeHistory(data.events, data.snapshots) : 0;
  return { ...result, events };
}
