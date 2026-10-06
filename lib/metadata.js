import { thumbnailUrl } from './model.js';

// Pulls the JSON object that follows `marker` out of a page, e.g. `ytInitialPlayerResponse = {...};`
// Walks the braces by hand because the JSON can contain `}` inside strings.
export function extractJsonAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf('{', at + marker.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function parsePlayerResponse(playerResponse) {
  const d = playerResponse && playerResponse.videoDetails;
  if (!d || !d.videoId) return null;
  const views = d.viewCount != null ? Number(d.viewCount) : null;
  const micro = playerResponse.microformat && playerResponse.microformat.playerMicroformatRenderer;
  const published = Date.parse((micro && (micro.publishDate || micro.uploadDate)) || '');
  return {
    id: d.videoId,
    title: d.title || d.videoId,
    channel: d.author || '',
    durationSec: Number(d.lengthSeconds) || null, // live streams report 0
    views: Number.isFinite(views) ? views : null,
    publishedAt: Number.isFinite(published) ? published : null,
  };
}

// Reads the public watch page of the video (same thing your browser does when you open it).
export async function fetchVideoMeta(id, fetchImpl = fetch) {
  const res = await fetchImpl(`https://www.youtube.com/watch?v=${id}&hl=en`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`YouTube answered ${res.status}`);
  const html = await res.text();
  const meta = parsePlayerResponse(extractJsonAfter(html, 'ytInitialPlayerResponse = '));
  if (!meta) throw new Error('No video details found on the page');
  return { ...meta, detailsAt: Date.now() };
}

// Used when the page can't be read: keep whatever we saw in the right-clicked card.
export function fallbackMeta(id, hint) {
  return {
    id,
    title: (hint && hint.title) || id,
    channel: (hint && hint.channel) || '',
    durationSec: null,
    views: null,
    thumbnail: thumbnailUrl(id),
  };
}
