// Pure filter / sort / format helpers for the dialog.
import { parseViews } from './model.js';

const DAY = 24 * 60 * 60 * 1000;

// Presets for duration and views: min is included, max is not.
export const DURATION_BUCKETS = [
  { key: 'short', label: 'Under 10 min', min: 0, max: 600 },
  { key: 'medium', label: '10–30 min', min: 600, max: 1800 },
  { key: 'long', label: '30–60 min', min: 1800, max: 3600 },
  { key: 'xlong', label: 'Over 1 hour', min: 3600, max: Infinity },
];

// "Does what is left fit in my free time?" These overlap on purpose: under 5 min is also under 10.
export const TIME_LEFT_BUCKETS = [
  { key: 'left5', label: 'Under 5 min left', min: 0, max: 300 },
  { key: 'left10', label: 'Under 10 min left', min: 0, max: 600 },
  { key: 'left20', label: 'Under 20 min left', min: 0, max: 1200 },
  { key: 'left30', label: 'Under 30 min left', min: 0, max: 1800 },
  { key: 'left60', label: 'Under 1 hour left', min: 0, max: 3600 },
];

export const VIEW_BUCKETS = [
  { key: 'low', label: 'Under 10K views', min: 0, max: 1e4 },
  { key: 'mid', label: '10K–100K views', min: 1e4, max: 1e5 },
  { key: 'high', label: '100K–1M views', min: 1e5, max: 1e6 },
  { key: 'huge', label: 'Over 1M views', min: 1e6, max: Infinity },
];

// Presets for "published" and "saved" dates.
export const DATE_PRESETS = [
  { key: '7d', label: 'Last 7 days', withinDays: 7 },
  { key: '30d', label: 'Last 30 days', withinDays: 30 },
  { key: '90d', label: 'Last 3 months', withinDays: 90 },
  { key: '365d', label: 'Last year', withinDays: 365 },
  { key: 'old', label: 'Older than 1 year', olderThanDays: 365 },
];

export const SORT_OPTIONS = [
  { key: 'added-desc', label: 'Recently saved' },
  { key: 'added-asc', label: 'Oldest saved' },
  { key: 'published-desc', label: 'Newest published' },
  { key: 'published-asc', label: 'Oldest published' },
  { key: 'duration-asc', label: 'Shortest first' },
  { key: 'duration-desc', label: 'Longest first' },
  { key: 'left-asc', label: 'Least time left' },
  { key: 'left-desc', label: 'Most time left' },
  { key: 'views-desc', label: 'Most viewed' },
  { key: 'views-asc', label: 'Least viewed' },
  { key: 'title-asc', label: 'Title A–Z' },
  { key: 'title-desc', label: 'Title Z–A' },
  { key: 'channel-asc', label: 'Channel A–Z' },
  { key: 'channel-desc', label: 'Channel Z–A' },
];

// ---------- ranges ----------

function presetRange(kind, key, now) {
  if (kind === 'duration' || kind === 'timeLeft' || kind === 'views') {
    const buckets = { duration: DURATION_BUCKETS, timeLeft: TIME_LEFT_BUCKETS, views: VIEW_BUCKETS }[kind];
    const b = buckets.find((x) => x.key === key);
    return b && { min: b.min, max: b.max === Infinity ? null : b.max, maxExclusive: true };
  }
  const p = DATE_PRESETS.find((x) => x.key === key);
  if (!p) return null;
  return p.withinDays
    ? { min: now - p.withinDays * DAY, max: null, maxExclusive: false }
    : { min: null, max: now - p.olderThanDays * DAY, maxExclusive: true };
}

// value is '' (no filter), a preset key, or a custom range { min, max } (both ends included).
export function resolveRange(kind, value, now = Date.now()) {
  if (!value) return null;
  if (typeof value === 'string') return presetRange(kind, value, now) || null;
  if (value.min == null && value.max == null) return null;
  return { min: value.min ?? null, max: value.max ?? null, maxExclusive: false };
}

function inRange(value, range) {
  if (!range) return true;
  if (value === null || value === undefined) return false; // unknown values never match an active filter
  if (range.min != null && value < range.min) return false;
  if (range.max != null && (range.maxExclusive ? value >= range.max : value > range.max)) return false;
  return true;
}

function parseDateInput(text, isEnd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || '').trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isEnd) d.setDate(d.getDate() + 1); // the whole "to" day counts
  const t = d.getTime();
  return Number.isNaN(t) ? null : t - (isEnd ? 1 : 0);
}

// Turns what the user typed into a range, or null when both boxes are empty / unreadable.
//   duration, timeLeft -> minutes ("90", "1.5")  -> seconds
//   views     -> "10k", "1.5M", "2,000"          -> number
//   published / saved -> "YYYY-MM-DD" (date box) -> milliseconds
// If "from" is bigger than "to" the two are swapped.
export function customRange(kind, rawMin, rawMax) {
  const parse = (text, isEnd) => {
    const t = String(text ?? '').trim();
    if (!t) return null;
    if (kind === 'duration' || kind === 'timeLeft') {
      const n = parseFloat(t.replace(',', '.'));
      return Number.isFinite(n) && n >= 0 ? n * 60 : null;
    }
    if (kind === 'views') return parseViews(t);
    return parseDateInput(t, isEnd);
  };
  const a = parse(rawMin, false);
  const b = parse(rawMax, false);
  if (a != null && b != null && a > b) [rawMin, rawMax] = [rawMax, rawMin];
  const min = parse(rawMin, false);
  const max = parse(rawMax, true);
  return min == null && max == null ? null : { min, max };
}

// f = { list, query, channel, tag, duration, timeLeft, views, published, saved } — empty means "no filter".
// duration / timeLeft / views / published / saved accept a preset key or a range from customRange().
export function applyFilters(videos, f = {}, now = Date.now()) {
  const query = (f.query || '').trim().toLowerCase();
  const duration = resolveRange('duration', f.duration, now);
  const timeLeft = resolveRange('timeLeft', f.timeLeft, now);
  const views = resolveRange('views', f.views, now);
  const published = resolveRange('published', f.published, now);
  const saved = resolveRange('saved', f.saved, now);
  return videos.filter((v) => {
    if (f.list && v.list !== f.list) return false;
    if (f.channel && v.channel !== f.channel) return false;
    if (f.tag && !v.tags.includes(f.tag)) return false;
    if (!inRange(v.durationSec, duration)) return false;
    if (!inRange(v.timeLeftSec, timeLeft)) return false;
    if (!inRange(v.views, views)) return false;
    if (!inRange(v.publishedAt, published)) return false;
    if (!inRange(v.addedAt, saved)) return false;
    if (query) {
      const haystack = `${v.title} ${v.channel} ${v.tags.join(' ')}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

// ---------- sorting ----------

// Missing numbers always go to the bottom, whichever direction is picked.
function byNumber(field, dir) {
  return (a, b) => {
    const x = a[field];
    const y = b[field];
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return dir === 'asc' ? x - y : y - x;
  };
}

export function sortVideos(videos, sortKey = 'added-desc') {
  const list = [...videos];
  switch (sortKey) {
    case 'added-asc':
      return list.sort(byNumber('addedAt', 'asc'));
    case 'published-desc':
      return list.sort(byNumber('publishedAt', 'desc'));
    case 'published-asc':
      return list.sort(byNumber('publishedAt', 'asc'));
    case 'duration-asc':
      return list.sort(byNumber('durationSec', 'asc'));
    case 'duration-desc':
      return list.sort(byNumber('durationSec', 'desc'));
    case 'left-asc':
      return list.sort(byNumber('timeLeftSec', 'asc'));
    case 'left-desc':
      return list.sort(byNumber('timeLeftSec', 'desc'));
    case 'views-desc':
      return list.sort(byNumber('views', 'desc'));
    case 'views-asc':
      return list.sort(byNumber('views', 'asc'));
    case 'title-asc':
      return list.sort((a, b) => a.title.localeCompare(b.title));
    case 'title-desc':
      return list.sort((a, b) => b.title.localeCompare(a.title));
    case 'channel-asc':
    case 'channel-desc': {
      // no channel always goes last; ties fall back to title so the order is stable
      const dir = sortKey === 'channel-asc' ? 1 : -1;
      return list.sort((a, b) => {
        if (!a.channel && !b.channel) return a.title.localeCompare(b.title);
        if (!a.channel) return 1;
        if (!b.channel) return -1;
        return dir * a.channel.localeCompare(b.channel) || a.title.localeCompare(b.title);
      });
    }
    case 'added-desc':
    default:
      return list.sort(byNumber('addedAt', 'desc'));
  }
}

// One video chosen at random from the list. `skipId` (the one you were just shown) is left out so "pick
// another" never repeats itself, unless it is the only one left. `random` is passed in so tests can control it.
export function pickRandom(videos, skipId = null, random = Math.random) {
  const pool = videos.length > 1 ? videos.filter((v) => v.id !== skipId) : videos;
  if (!pool.length) return null;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

export function uniqueChannels(videos) {
  const counts = new Map();
  for (const v of videos) {
    if (!v.channel) continue;
    counts.set(v.channel, (counts.get(v.channel) || 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function uniqueTags(videos) {
  const counts = new Map();
  for (const v of videos) {
    for (const t of v.tags) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- what do we know about each video? ----------

// How many videos have each piece of information. Title, thumbnail, saved date and tags always exist.
export function dataCoverage(videos) {
  const total = videos.length;
  const count = (test) => videos.filter(test).length;
  const have = (field) => count((v) => v[field] != null && v[field] !== '');
  const exact = count((v) => v.publishedAt != null && !v.publishedApprox);
  const approx = count((v) => v.publishedAt != null && v.publishedApprox);
  return {
    total,
    length: { have: have('durationSec'), missing: total - have('durationSec') },
    views: { have: have('views'), missing: total - have('views') },
    channel: { have: have('channel'), missing: total - have('channel') },
    published: { exact, approx, missing: total - exact - approx },
  };
}

// ---------- time to finish ----------

// Adds up what is left to watch: `timeLeftSec` when the video has it (see withProgress), else its length.
// `unknown` counts videos whose length we don't know yet.
export function totalDuration(videos, speed = 1) {
  const rate = speed > 0 ? speed : 1;
  let sum = 0;
  let unknown = 0;
  for (const v of videos) {
    const left = v.timeLeftSec ?? v.durationSec;
    if (left == null) unknown++;
    else sum += left;
  }
  return { seconds: sum / rate, unknown, known: videos.length - unknown };
}

// A day is 24 hours and a month is counted as 30 days (calendar months vary).
// 45 -> "45s", 2700 -> "45m", 30300 -> "8h 25m", 633600 -> "7d 8h", 5400000 -> "2mo 2d 12h".
// Units that are zero are skipped: 172800 -> "2d".
export function formatTotalTime(sec) {
  const total = Math.round(sec);
  if (total < 60) return `${total}s`;
  let minutes = Math.round(total / 60); // rounded first so we never print "60m"
  const parts = [];
  for (const [unit, size] of [
    ['mo', 30 * 24 * 60],
    ['d', 24 * 60],
    ['h', 60],
    ['m', 1],
  ]) {
    const n = Math.floor(minutes / size);
    minutes -= n * size;
    if (n) parts.push(`${n}${unit}`);
  }
  return parts.join(' ');
}

function plural(n, word) {
  return `${n} ${n === 1 ? word : `${word}s`}`;
}

// The same total as one number: 633600 -> "176 hours"
export function formatHours(sec) {
  return plural(Math.round((sec / 3600) * 10) / 10, 'hour');
}

// 633600 -> "7.3 days"
export function formatDays(sec) {
  return plural(Math.round((sec / 86400) * 10) / 10, 'day');
}

// ---------- display ----------

export function formatDuration(sec) {
  if (sec == null) return '';
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

function short(n, divisor, suffix) {
  const x = n / divisor;
  return `${x >= 100 ? Math.round(x) : Math.round(x * 10) / 10}${suffix}`;
}

export function formatViews(n) {
  if (n == null) return '';
  if (n === 1) return '1 view';
  if (n < 1e3) return `${n} views`;
  if (n < 1e6) return `${short(n, 1e3, 'K')} views`;
  if (n < 1e9) return `${short(n, 1e6, 'M')} views`;
  return `${short(n, 1e9, 'B')} views`;
}

export function formatDate(ms) {
  if (ms == null) return '';
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
