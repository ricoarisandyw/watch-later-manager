// Remembers how far you got in a saved video. It reads the player's own position, so it needs no
// extra permission. The decisions (what counts as a position, when a video is over) live in lib/progress.js.
import { SAVE_EVERY_MS, matchesLength, progressUpdate } from '../lib/progress.js';

// getRecord(id) -> the saved video, or undefined when it isn't saved (then nothing is tracked)
// save(id, sec)  -> sec is a number, or null to forget the position
export function createProgressTracker({ getRecord, save, now = Date.now }) {
  let lastId = null;
  let lastWrite = 0;
  let lastValue; // what we last wrote for lastId (a number, or null once cleared)

  // Call with the player's <video> while a saved video is on screen. `force` skips the 15-second
  // pause between writes (pause, tab hidden, ended).
  return function track(id, video, force = false) {
    const update = progressUpdate(video.currentTime, video.duration);
    if (update.type === 'ignore') return;
    if (id !== lastId) {
      lastId = id;
      lastWrite = 0;
      lastValue = undefined;
    }
    const value = update.type === 'save' ? update.sec : null;
    if (value === lastValue) return;
    const t = now();
    if (!force && update.type === 'save' && t - lastWrite < SAVE_EVERY_MS) return;
    const record = getRecord(id);
    if (!record || !matchesLength(video.duration, record.durationSec)) return;
    lastWrite = t;
    lastValue = value;
    save(id, value);
  };
}
