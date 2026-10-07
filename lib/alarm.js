// Pure helpers for the "ring me in a few minutes" alarm: no browser APIs here, so they can be unit tested with plain Node.

export const ALARM_NAME = 'mwl-alarm';
export const PRESET_MINUTES = [2, 3, 5];
export const MIN_MINUTES = 1; // chrome.alarms only guarantees a 1-minute minimum on older Chrome versions
export const MAX_MINUTES = 600;

// What you typed in the custom box -> minutes, or null when it isn't a usable time.
// Whole and half minutes are fine ("7", "1.5"); anything else is rounded to the nearest half.
export function parseCustomMinutes(text) {
  const value = Number(String(text ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(value) || value < MIN_MINUTES || value > MAX_MINUTES) return null;
  return Math.round(value * 2) / 2;
}

// Milliseconds left -> "4:32" (or "1:05:00" past an hour). Never negative.
export function formatRemaining(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
