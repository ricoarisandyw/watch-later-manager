// Talks to YouTube's own Watch Later page (youtube.com/playlist?list=WL) by clicking its buttons,
// exactly like you would. YouTube's page changes now and then, so every selector lives here.
// Works with YouTube set to English (it finds the "Remove from…" menu item by its text).

const ITEM = 'ytd-playlist-video-renderer';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check, timeout = 3000, step = 100) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = check();
    if (value) return value;
    await sleep(step);
  }
  return null;
}

export const count = () => document.querySelectorAll(ITEM).length;

// YouTube only loads the list as you scroll, so scroll until nothing new appears.
export async function loadAll(onProgress = () => {}, shouldStop = () => false) {
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 300 && stable < 4 && !shouldStop(); i++) {
    window.scrollTo(0, document.documentElement.scrollHeight);
    await sleep(700);
    const now = count();
    stable = now === last ? stable + 1 : 0;
    last = now;
    onProgress(now);
  }
  window.scrollTo(0, 0);
  return count();
}

function findMenuButton(item) {
  return (
    item.querySelector('ytd-menu-renderer button') ||
    item.querySelector('ytd-menu-renderer yt-icon-button') ||
    item.querySelector('button[aria-label*="menu" i]')
  );
}

function findRemoveItem() {
  const candidates = document.querySelectorAll(
    'ytd-popup-container ytd-menu-service-item-renderer, ytd-popup-container yt-list-item-view-model, ytd-popup-container tp-yt-paper-item',
  );
  for (const el of candidates) {
    if (!el.getClientRects().length) continue; // not showing
    if (/remove from/i.test(el.textContent || '')) return el;
  }
  return null;
}

function dismissMenu() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

async function removeOne(item) {
  item.scrollIntoView({ block: 'center' });
  const button = findMenuButton(item);
  if (!button) throw new Error('could not find the ⋮ menu on a video');
  button.click();
  const remove = await waitFor(findRemoveItem, 2500);
  if (!remove) {
    dismissMenu();
    throw new Error('could not find “Remove from Watch later” in the menu');
  }
  remove.click();
  const gone = await waitFor(() => !item.isConnected, 4000);
  if (!gone) throw new Error('YouTube did not remove the video');
}

// Removes videos from the top of the list, one by one, until the list is empty.
// Returns { removed, stopped: 'done' | 'user' | 'error', message? }.
export async function removeAll({ onProgress = () => {}, shouldStop = () => false } = {}) {
  let removed = 0;
  let failsInARow = 0;
  let emptyRounds = 0;

  while (!shouldStop()) {
    const item = document.querySelector(ITEM);
    if (!item) {
      // maybe more are still loading in: scroll once and look again before calling it done
      window.scrollTo(0, document.documentElement.scrollHeight);
      await sleep(1200);
      if (document.querySelector(ITEM)) {
        emptyRounds = 0;
      } else if (++emptyRounds >= 2) {
        return { removed, stopped: 'done' };
      }
      continue;
    }
    emptyRounds = 0;
    try {
      await removeOne(item);
      removed++;
      failsInARow = 0;
    } catch (err) {
      if (++failsInARow >= 3) return { removed, stopped: 'error', message: err.message };
    }
    onProgress({ removed, remaining: count() });
    await sleep(300); // be gentle with YouTube
  }
  return { removed, stopped: 'user' };
}
