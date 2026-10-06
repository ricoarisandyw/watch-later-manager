// Pure helpers: no browser APIs here, so they can be unit tested with plain Node.

export const LISTS = Object.freeze({
  WATCH_LATER: 'watchLater',
  REWATCH: 'rewatch',
});

const ID_RE = /^[\w-]{11}$/;

export function thumbnailUrl(id) {
  return `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;
}

export function watchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

// Accepts watch links, youtu.be links, /shorts/, /embed/, /live/ and relative links.
export function parseVideoId(input) {
  if (!input || typeof input !== 'string') return null;
  let url;
  try {
    url = new URL(input, 'https://www.youtube.com');
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  let id = null;
  if (host === 'youtu.be') {
    id = url.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com') {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      const m = url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?]+)/);
      if (m) id = m[1];
    }
  }
  return id && ID_RE.test(id) ? id : null;
}

// "12:34" -> 754, "1:02:03" -> 3723, anything else -> null
export function parseDuration(text) {
  if (typeof text !== 'string') return null;
  const m = text.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

// "1.2M" -> 1200000, "12,345" -> 12345, "No views" -> 0
export function parseViews(text) {
  if (typeof text !== 'string') return null;
  if (/no views/i.test(text)) return 0;
  const m = text.replace(/ /g, ' ').match(/(\d[\d.,]*)\s*([KMB])?/i);
  if (!m) return null;
  const suffix = m[2] ? m[2].toUpperCase() : '';
  const num = suffix
    ? parseFloat(m[1].replace(/,/g, ''))
    : parseInt(m[1].replace(/[.,]/g, ''), 10);
  if (!Number.isFinite(num)) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9 }[suffix] || 1;
  return Math.round(num * mult);
}

// "2 years ago" -> a date about 2.5 years back. YouTube rounds down ("2 years ago" can be anything from
// 2 to 3 years), so we aim for the middle. Only an estimate: reading the video page gives the exact date.
export function parseRelativeAge(text, now = Date.now()) {
  const m = String(text ?? '').match(/(\d+)\s*(second|minute|hour|day|week|month|year)s?\s+ago/i);
  if (!m) return null;
  const unit = {
    second: 1e3,
    minute: 6e4,
    hour: 36e5,
    day: 864e5,
    week: 6048e5,
    month: 30 * 864e5,
    year: 365 * 864e5,
  }[m[2].toLowerCase()];
  return Math.round(now - (Number(m[1]) + 0.5) * unit);
}

export function normalizeTag(tag) {
  return String(tag ?? '')
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .slice(0, 30);
}

function cleanTags(tags) {
  const list = Array.isArray(tags) ? tags : [];
  return [...new Set(list.map(normalizeTag).filter(Boolean))];
}

function numberOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Makes any object (fresh metadata, imported file, old data) into a valid record, or null.
export function normalizeRecord(raw, now = Date.now()) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '');
  if (!ID_RE.test(id)) return null;
  return {
    id,
    title: String(raw.title || id).slice(0, 300),
    channel: String(raw.channel || '').slice(0, 120),
    durationSec: numberOrNull(raw.durationSec),
    views: numberOrNull(raw.views),
    publishedAt: numberOrNull(raw.publishedAt), // when the video went up on YouTube (ms)
    publishedApprox: raw.publishedAt != null && raw.publishedApprox === true, // true = estimated from "2 years ago"
    detailsAt: numberOrNull(raw.detailsAt), // when we last read its details from YouTube (ms)
    thumbnail: thumbnailUrl(id),
    addedAt: numberOrNull(raw.addedAt) ?? now, // when you saved it (ms)
    movedAt: numberOrNull(raw.movedAt),
    list: raw.list === LISTS.REWATCH ? LISTS.REWATCH : LISTS.WATCH_LATER,
    tags: cleanTags(raw.tags),
  };
}

export function createRecord(meta, now = Date.now()) {
  return normalizeRecord({ ...meta, list: LISTS.WATCH_LATER, movedAt: null, addedAt: now }, now);
}

// Adds videos we don't have yet. Videos we already have are kept as they are, except that they
// pick up new tags and any piece of information they were missing (never overwriting what we have).
export function mergeImport(existing, incoming, now = Date.now()) {
  const videos = { ...existing };
  let added = 0;
  let already = 0;
  let invalid = 0;
  for (const raw of Array.isArray(incoming) ? incoming : []) {
    const rec = normalizeRecord(raw, now);
    if (!rec) {
      invalid++;
      continue;
    }
    const current = videos[rec.id];
    if (current) {
      already++;
      const filled = { ...current, tags: cleanTags([...current.tags, ...rec.tags]) };
      for (const key of ['durationSec', 'views']) {
        if (filled[key] == null && rec[key] != null) filled[key] = rec[key];
      }
      if (!filled.channel && rec.channel) filled.channel = rec.channel;
      if (filled.publishedAt == null && rec.publishedAt != null) {
        filled.publishedAt = rec.publishedAt;
        filled.publishedApprox = rec.publishedApprox;
      }
      videos[rec.id] = filled;
    } else {
      videos[rec.id] = rec;
      added++;
    }
  }
  return { videos, added, already, invalid };
}
