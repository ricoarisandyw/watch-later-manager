import { parseVideoId } from './lib/model.js';
import { fetchVideoMeta, fallbackMeta } from './lib/metadata.js';
import { ensureBackfill, getVideo, saveVideo } from './lib/storage.js';

const MENU_ID = 'mwl-add';

function createMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Add to My Watch Later',
      contexts: ['link', 'video', 'page'],
      documentUrlPatterns: ['https://www.youtube.com/*'],
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenu);
chrome.runtime.onStartup.addListener(createMenu);

// Turn the videos you already have into history, once, so the Stats charts don't start empty.
chrome.runtime.onInstalled.addListener(() => ensureBackfill().catch((err) => console.warn(err)));
chrome.runtime.onStartup.addListener(() => ensureBackfill().catch((err) => console.warn(err)));

// Shows a small tick or cross on the toolbar icon. Works even if the page was opened
// before the extension was installed (the page toast needs a refresh in that case).
async function flashBadge(text, color) {
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
  } catch {
    // badge is only a nice-to-have
  }
}

function tell(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message).catch(() => null);
}

// The page remembers what you right-clicked (title, channel) in case reading the video page fails.
async function askForHint(tabId, id) {
  const hint = await tell(tabId, { type: 'get-hint' });
  return hint && hint.id === id ? hint : null;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab || tab.id == null) return;

  const id = parseVideoId(info.linkUrl) || parseVideoId(info.pageUrl);
  if (!id) {
    flashBadge('?', '#8a8a8a');
    tell(tab.id, {
      type: 'toast',
      text: "Couldn't find a video here",
      sub: 'Right-click a video thumbnail or a video page.',
    });
    return;
  }

  const existing = await getVideo(id);
  if (existing) {
    flashBadge('✓', '#2e7d32');
    tell(tab.id, {
      type: 'toast',
      text: 'Already in My Watch Later',
      sub: existing.title,
      tagId: id,
    });
    return;
  }

  const hint = await askForHint(tab.id, id);
  let meta;
  try {
    meta = await fetchVideoMeta(id);
  } catch (err) {
    console.warn('[My Watch Later] could not read video details, saving what we know', err);
    meta = fallbackMeta(id, hint);
  }
  // Fill any gaps with what the page card showed.
  if (hint) {
    if (!meta.title || meta.title === id) meta.title = hint.title || meta.title;
    if (!meta.channel) meta.channel = hint.channel || '';
  }

  try {
    const { record } = await saveVideo(meta);
    flashBadge('✓', '#2e7d32');
    tell(tab.id, {
      type: 'toast',
      text: 'Saved to My Watch Later',
      sub: record.title,
      tagId: record.id,
    });
  } catch (err) {
    console.error('[My Watch Later] save failed', err);
    flashBadge('!', '#c62828');
    tell(tab.id, { type: 'toast', text: "Couldn't save this video", sub: String(err.message || err) });
  }
});
