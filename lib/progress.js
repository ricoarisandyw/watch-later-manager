// Pure helpers for "how far did I get?": no browser APIs here, so they can be unit tested with plain Node.

export const SAVE_EVERY_MS = 15000; // how often the position is written while a video plays
const MIN_SAVE_SEC = 5; // the first seconds are not worth remembering (and a fresh page load starts at 0)
const FINISHED_WITHIN_SEC = 5; // this close to the end the video counts as watched
const MIN_VIDEO_SEC = 20; // shorter videos are not tracked

// What to do with the player's position:
//   { type: 'save', sec }  remember it
//   { type: 'clear' }      the video is over, so there is nothing left to resume
//   { type: 'ignore' }     not a real position (live stream, not loaded yet, the very start)
export function progressUpdate(currentSec, durationSec) {
  if (!Number.isFinite(currentSec) || !Number.isFinite(durationSec)) return { type: 'ignore' }; // live: duration is Infinity
  if (durationSec < MIN_VIDEO_SEC) return { type: 'ignore' };
  if (currentSec >= durationSec - FINISHED_WITHIN_SEC) return { type: 'clear' };
  if (currentSec < MIN_SAVE_SEC) return { type: 'ignore' };
  return { type: 'save', sec: Math.round(currentSec) };
}

// YouTube reuses one <video> element for every page, so right after you navigate it can still report
// the old video. A saved length that disagrees with the player's means it is not our video.
export function matchesLength(playerSec, savedSec) {
  if (savedSec == null) return true; // nothing to compare with
  return Math.abs(playerSec - savedSec) <= 2;
}

// Seconds still to watch. Unknown length stays unknown; no progress means the whole video is left.
export function timeLeftSec(durationSec, progressSec) {
  if (durationSec == null) return null;
  const done = progressSec > 0 ? Math.min(progressSec, durationSec) : 0;
  return durationSec - done;
}

// Copies of the videos with `progressSec` (null when never started) and `timeLeftSec` added.
// `progress` is the stored map: video id -> { sec, at }.
export function withProgress(videos, progress = {}) {
  return videos.map((v) => {
    const sec = progress[v.id] && progress[v.id].sec;
    const progressSec = Number.isFinite(sec) && sec > 0 ? sec : null;
    return { ...v, progressSec, timeLeftSec: timeLeftSec(v.durationSec, progressSec) };
  });
}
