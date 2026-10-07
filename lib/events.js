// The history log: what an event looks like, plus all the math the Stats tab needs.
// Pure functions only (no browser APIs), so everything here is unit tested with plain Node.
import { DURATION_BUCKETS } from './filters.js';
import { LISTS } from './model.js';

export const EVENT = Object.freeze({
  ADDED: 'added', // source: 'rightclick' | 'import' | 'backfill'
  FINISHED: 'finished', // a saved video reached its end
  REMOVED: 'removed', // reason: 'done' | 'manual' | 'bulk' | 'clear'
  RESTORED: 'restored', // Undo of a removal: cancels that removal in the stats
  MOVED: 'moved', // to: 'rewatch' | 'watchLater'
  TAGGED: 'tagged', // tag
  PROMPT: 'prompt', // choice: 'rewatch' | 'remove' | 'continue', kind: 'open' | 'end'
});

export const MAX_EVENTS = 20000;

const DAY = 24 * 60 * 60 * 1000;
const pad = (n) => String(n).padStart(2, '0');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Only these fields are ever kept on an event (also used to clean imported files).
const FIELDS = ['t', 'type', 'id', 'source', 'reason', 'to', 'tag', 'choice', 'kind', 'channel', 'durationSec'];

export function makeEvent(type, id, fields = {}, now = Date.now()) {
  return { t: now, type, id, ...fields };
}

// Same, copying the channel and length from a saved video.
export function eventFor(type, video, fields = {}, now = Date.now()) {
  return makeEvent(
    type,
    video.id,
    { channel: video.channel || '', durationSec: video.durationSec ?? null, ...fields },
    now,
  );
}

// Returns a clean copy of an event from an imported file, or null if it isn't a usable event.
export function sanitizeEvent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (!Number.isFinite(raw.t) || typeof raw.id !== 'string' || !Object.values(EVENT).includes(raw.type)) {
    return null;
  }
  const out = {};
  for (const key of FIELDS) if (raw[key] !== undefined) out[key] = raw[key];
  return out;
}

export const eventKey = (e) => `${e.t}|${e.type}|${e.id}|${e.reason || e.source || e.to || e.tag || e.choice || ''}`;

// ---------- dates (local time, weeks start on Monday) ----------

export function dayStart(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function weekStart(ms) {
  const d = new Date(ms);
  const back = (d.getDay() + 6) % 7; // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
}

export function monthStart(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function dayKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDayKey(key) {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

export function bucketStart(ms, step) {
  return step === 'month' ? monthStart(ms) : step === 'week' ? weekStart(ms) : dayStart(ms);
}

export function nextBucket(start, step) {
  const d = new Date(start);
  if (step === 'month') return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + (step === 'week' ? 7 : 1)).getTime();
}

// Daily bars for about a month, weekly for about a year, monthly beyond that.
export function pickStep(spanDays) {
  return spanDays <= 45 ? 'day' : spanDays <= 400 ? 'week' : 'month';
}

export const RANGES = [
  { key: '7d', label: '7 days', days: 7 },
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: '1y', label: '1 year', days: 365 },
  { key: 'all', label: 'All time', days: null },
];

// { from, to, step } for a range key. "From" is the start of the first day, so "7 days" = today + 6 before.
export function rangeBounds(key, events, now = Date.now()) {
  const range = RANGES.find((r) => r.key === key) || RANGES[1];
  let from;
  if (range.days) {
    const d = new Date(now);
    from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - (range.days - 1)).getTime();
  } else {
    let first = Infinity;
    for (const e of events) if (e.t < first) first = e.t;
    from = Number.isFinite(first) ? dayStart(first) : dayStart(now - 29 * DAY);
  }
  return { from, to: now, step: pickStep((now - from) / DAY) };
}

// ---------- cleaning ----------

// An "restored" event (Undo) cancels the removal it undid, so an undone removal never counts.
// Returns the events in time order, without restored events and without the removals they cancelled.
export function effectiveEvents(events) {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const out = [];
  const lastRemoval = new Map(); // video id -> position in `out` of its latest removal
  for (const e of sorted) {
    if (e.type === EVENT.REMOVED) {
      lastRemoval.set(e.id, out.length);
      out.push(e);
    } else if (e.type === EVENT.RESTORED) {
      const at = lastRemoval.get(e.id);
      if (at !== undefined && out[at]) {
        out[at] = null;
        lastRemoval.delete(e.id);
      }
    } else {
      out.push(e);
    }
  }
  return out.filter(Boolean);
}

const isImportAdd = (e) => e.type === EVENT.ADDED && e.source === 'import';

// Events inside the range, optionally without imported videos (a one-off import of 800 videos
// would otherwise flatten every chart).
export function inRange(events, { from, to, includeImports = false }) {
  return events.filter((e) => e.t >= from && e.t <= to && (includeImports || !isImportAdd(e)));
}

// Videos that were imported before history existed look like a run saved exactly 1 second apart
// (that is how Import stamps them). Right-click saves never do that, so a run of 5+ means "imported".
export function detectImportRuns(videos, minRun = 5) {
  const sorted = [...videos].sort((a, b) => a.addedAt - b.addedAt);
  const found = new Set();
  let run = [];
  const flush = () => {
    if (run.length >= minRun) for (const v of run) found.add(v.id);
    run = [];
  };
  for (const v of sorted) {
    if (run.length && v.addedAt - run[run.length - 1].addedAt === 1000) run.push(v);
    else {
      flush();
      run = [v];
    }
  }
  flush();
  return found;
}

// ---------- numbers for the Stats tab ----------

// opts = { from, to, includeImports }
export function summarize(events, opts) {
  const all = effectiveEvents(events);
  const scoped = inRange(all, opts);
  const finishedEver = new Set(all.filter((e) => e.type === EVENT.FINISHED).map((e) => e.id));
  const removed = scoped.filter((e) => e.type === EVENT.REMOVED);
  return {
    added: scoped.filter((e) => e.type === EVENT.ADDED).length,
    finished: new Set(scoped.filter((e) => e.type === EVENT.FINISHED).map((e) => e.id)).size,
    removedDone: removed.filter((e) => e.reason === 'done').length,
    // thrown away without ever finishing it
    removedUnwatched: removed.filter((e) => e.reason !== 'done' && !finishedEver.has(e.id)).length,
    toRewatch: scoped.filter((e) => e.type === EVENT.MOVED && e.to === LISTS.REWATCH).length,
  };
}

// Of every video ever added, how many have been finished? (Not tied to the range, so it can't pass 100%.)
export function finishRate(events, includeImports = false) {
  const all = effectiveEvents(events);
  const added = new Set();
  for (const e of all) {
    if (e.type === EVENT.ADDED && (includeImports || e.source !== 'import')) added.add(e.id);
  }
  const finished = new Set(all.filter((e) => e.type === EVENT.FINISHED).map((e) => e.id));
  const done = [...added].filter((id) => finished.has(id)).length;
  return { added: added.size, finished: done, rate: added.size ? done / added.size : null };
}

// One entry per day / week / month in the range, including quiet ones: { start, added, finished }.
export function seriesByPeriod(events, { from, to, step, includeImports = false }) {
  const scoped = inRange(effectiveEvents(events), { from, to, includeImports });
  const buckets = new Map();
  for (let s = bucketStart(from, step); s <= to; s = nextBucket(s, step)) {
    buckets.set(s, { start: s, added: 0, finishedIds: new Set() });
  }
  for (const e of scoped) {
    const bucket = buckets.get(bucketStart(e.t, step));
    if (!bucket) continue;
    if (e.type === EVENT.ADDED) bucket.added++;
    else if (e.type === EVENT.FINISHED) bucket.finishedIds.add(e.id);
  }
  return [...buckets.values()].map((b) => ({ start: b.start, added: b.added, finished: b.finishedIds.size }));
}

// Points for the "list size over time" line, from the daily snapshots: { t, n, sec }.
export function backlogSeries(snapshots, { from, to }) {
  return Object.entries(snapshots || {})
    .map(([key, v]) => ({ t: parseDayKey(key), n: v.n, sec: v.sec }))
    .filter((p) => p.t >= from && p.t <= to)
    .sort((a, b) => a.t - b.t);
}

// How fast you add and finish, per week, over the last few weeks. Only real activity counts:
// imports and "backfill" don't, and the window never reaches back before logging began.
export function paceStats(events, now = Date.now(), windowDays = 28) {
  const all = effectiveEvents(events);
  const real = all.filter((e) => !(e.type === EVENT.ADDED && (e.source === 'import' || e.source === 'backfill')));
  const logStart = real.length ? real[0].t : now;
  const spanDays = Math.max(7, Math.min(windowDays, (now - logStart) / DAY));
  const from = now - spanDays * DAY;
  const weeks = spanDays / 7;
  const inWindow = real.filter((e) => e.t >= from && e.t <= now);
  const adds = inWindow.filter((e) => e.type === EVENT.ADDED);
  const seen = new Set();
  const finishes = inWindow.filter((e) => {
    if (e.type !== EVENT.FINISHED || seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
  const sum = (list) => list.reduce((s, e) => s + (e.durationSec || 0), 0);
  return {
    weeks,
    sampleDays: spanDays,
    addedPerWeek: adds.length / weeks,
    finishedPerWeek: finishes.length / weeks,
    secAddedPerWeek: sum(adds) / weeks,
    secFinishedPerWeek: sum(finishes) / weeks,
  };
}

// Will the list ever empty? Works for counts or for seconds, as long as all three use the same unit.
export function clearEta({ backlog, addedPerWeek, finishedPerWeek }) {
  if (backlog <= 0) return { status: 'empty' };
  if (!(finishedPerWeek > 0)) return { status: 'stalled' };
  const net = finishedPerWeek - addedPerWeek;
  if (net <= 0) return { status: 'growing', perWeek: Math.max(0, -net) }; // max(): never "-0"
  return { status: 'clearing', weeks: backlog / net };
}

// 3 -> "3 days", 40 -> "6 weeks", 400 -> "13 months", 800 -> "2.2 years"
export function formatSpan(days) {
  if (days < 1) return 'less than a day';
  if (days < 14) return plural(Math.round(days), 'day');
  if (days < 60) return plural(Math.round(days / 7), 'week');
  if (days < 730) return plural(Math.round(days / 30), 'month');
  return plural(Math.round((days / 365) * 10) / 10, 'year');
}

// Days between saving a video and first finishing it: { count, medianDays, avgDays }.
export function timeToFinish(events) {
  const all = effectiveEvents(events);
  const firstAdded = new Map();
  for (const e of all) if (e.type === EVENT.ADDED && !firstAdded.has(e.id)) firstAdded.set(e.id, e.t);
  const seen = new Set();
  const days = [];
  for (const e of all) {
    if (e.type !== EVENT.FINISHED || seen.has(e.id)) continue;
    seen.add(e.id);
    const added = firstAdded.get(e.id);
    if (added != null && added <= e.t) days.push((e.t - added) / DAY);
  }
  if (!days.length) return { count: 0, medianDays: null, avgDays: null };
  days.sort((a, b) => a - b);
  const mid = Math.floor(days.length / 2);
  const median = days.length % 2 ? days[mid] : (days[mid - 1] + days[mid]) / 2;
  return { count: days.length, medianDays: median, avgDays: days.reduce((s, d) => s + d, 0) / days.length };
}

// Videos saved a long time ago and never finished.
export function graveyard(videos, events, now = Date.now(), days = 90) {
  const finished = new Set(effectiveEvents(events).filter((e) => e.type === EVENT.FINISHED).map((e) => e.id));
  const cutoff = now - days * DAY;
  const stale = videos
    .filter((v) => v.list === LISTS.WATCH_LATER && v.addedAt < cutoff && !finished.has(v.id))
    .sort((a, b) => a.addedAt - b.addedAt);
  return { count: stale.length, cutoff, oldest: stale.slice(0, 5) };
}

// Finish rate per length bucket or per channel, over every video ever added.
// Rows: { label, added, finished, rate }.
export function completionBreakdown(events, { by = 'length', includeImports = false } = {}) {
  const all = effectiveEvents(events);
  const firstAdd = new Map();
  for (const e of all) {
    if (e.type !== EVENT.ADDED || (!includeImports && e.source === 'import')) continue;
    if (!firstAdd.has(e.id)) firstAdd.set(e.id, e);
  }
  const finished = new Set(all.filter((e) => e.type === EVENT.FINISHED).map((e) => e.id));
  const labelOf = (e) => {
    if (by === 'channel') return e.channel || 'Unknown';
    if (e.durationSec == null) return 'Unknown length';
    const bucket = DURATION_BUCKETS.find((b) => e.durationSec >= b.min && e.durationSec < b.max);
    return bucket ? bucket.label : 'Unknown length';
  };
  const rows = new Map();
  for (const [id, e] of firstAdd) {
    const label = labelOf(e);
    const row = rows.get(label) || { label, added: 0, finished: 0 };
    row.added++;
    if (finished.has(id)) row.finished++;
    rows.set(label, row);
  }
  const list = [...rows.values()].map((r) => ({ ...r, rate: r.finished / r.added }));
  if (by === 'channel') return list.sort((a, b) => b.added - a.added || a.label.localeCompare(b.label));
  const order = [...DURATION_BUCKETS.map((b) => b.label), 'Unknown length'];
  return list.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
}

// When do you finish videos? byWeekday[0] = Monday ... [6] = Sunday, byHour[0..23].
export function bestTimes(events) {
  const byWeekday = Array(7).fill(0);
  const byHour = Array(24).fill(0);
  for (const e of effectiveEvents(events)) {
    if (e.type !== EVENT.FINISHED) continue;
    const d = new Date(e.t);
    byWeekday[(d.getDay() + 6) % 7]++;
    byHour[d.getHours()]++;
  }
  return { byWeekday, byHour, total: byWeekday.reduce((a, b) => a + b, 0) };
}

// Days in a row with at least one finished video. The current streak survives until the end of today.
export function streak(events, now = Date.now()) {
  const days = [
    ...new Set(effectiveEvents(events).filter((e) => e.type === EVENT.FINISHED).map((e) => dayStart(e.t))),
  ].sort((a, b) => a - b);
  const nextDay = (ms) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  };
  let longest = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && nextDay(days[i - 1]) === days[i] ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  const prevDay = (ms) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime();
  };
  const have = new Set(days);
  const today = dayStart(now);
  let cursor = have.has(today) ? today : have.has(prevDay(today)) ? prevDay(today) : null;
  let current = 0;
  while (cursor !== null && have.has(cursor)) {
    current++;
    cursor = prevDay(cursor);
  }
  return { current, longest };
}

// Of the videos you finished, how many did you send to Should Rewatch?
export function rewatchRate(events) {
  const all = effectiveEvents(events);
  const finished = new Set(all.filter((e) => e.type === EVENT.FINISHED).map((e) => e.id));
  const rewatch = new Set(all.filter((e) => e.type === EVENT.MOVED && e.to === LISTS.REWATCH).map((e) => e.id));
  const both = [...finished].filter((id) => rewatch.has(id)).length;
  return { finished: finished.size, toRewatch: both, rate: finished.size ? both / finished.size : null };
}
