import { ALARM_NAME, parseCustomMinutes } from './lib/alarm.js';
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

// ---------- the alarm (set from the "Saved in My Watch Later" notice or the toolbar popup) ----------
// Either one creates a chrome.alarms alarm; when it fires we show a notification and ring from a hidden page.

const ALARM_NOTIFICATION = 'mwl-alarm-ring';
const OFFSCREEN_URL = 'offscreen/offscreen.html';

// "Needs Stop": set when the alarm goes off, cleared only when you stop it (Stop button, clicking or closing
// the notification) or set a new one. It outlives the sound, which ends by itself after ~20 seconds, so a page
// that opens later (next video, reloaded tab) still shows Stop instead of the time choices.
const NEEDS_STOP_KEY = 'alarmNeedsStop';

async function ringAlarm() {
  await chrome.storage.session.set({ [NEEDS_STOP_KEY]: true }).catch(() => {});
  chrome.notifications.create(ALARM_NOTIFICATION, {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('icons/icon128.png'),
    title: "Time's up",
    message: 'Your alarm went off. Click to stop it.',
    priority: 2,
    requireInteraction: true,
  });
  flashBadge('!', '#cc0000');
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Play the alarm sound when the timer ends',
      });
    }
    await chrome.runtime.sendMessage({ type: 'alarm-ring' });
  } catch (err) {
    console.warn('[My Watch Later] could not play the alarm sound', err); // the notification still shows
  }
}

// Silence the sound and the notification, but leave "needs Stop" as it is.
async function silenceAlarm() {
  chrome.notifications.clear(ALARM_NOTIFICATION);
  try {
    if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
  } catch {
    // already gone
  }
}

// You dealt with it: silence it and forget that it needs Stop.
async function stopAlarm() {
  await chrome.storage.session.remove(NEEDS_STOP_KEY).catch(() => {});
  await silenceAlarm();
}

async function isRinging() {
  try {
    return Boolean((await chrome.storage.session.get(NEEDS_STOP_KEY))[NEEDS_STOP_KEY]);
  } catch {
    return false;
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) ringAlarm();
});
chrome.notifications.onClicked.addListener((id) => {
  if (id === ALARM_NOTIFICATION) stopAlarm();
});
// Only when you close it yourself. On macOS a banner also "closes" by itself after a few seconds,
// and that must not silence the sound.
chrome.notifications.onClosed.addListener((id, byUser) => {
  if (id === ALARM_NOTIFICATION && byUser) stopAlarm();
});
// The page's alarm box talks to us here (the toolbar popup uses chrome.alarms directly).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return false;
  if (message.type === 'alarm-sound-done') {
    silenceAlarm(); // the beeps are over, but the box keeps showing Stop until you press it
  } else if (message.type === 'alarm-get') {
    Promise.all([chrome.alarms.get(ALARM_NAME), isRinging()]).then(([alarm, ringing]) =>
      sendResponse({ ringsAt: alarm ? alarm.scheduledTime : null, ringing }),
    );
    return true; // answer comes later
  } else if (message.type === 'alarm-stop') {
    stopAlarm().then(() => sendResponse({}));
    return true;
  } else if (message.type === 'alarm-start') {
    const minutes = parseCustomMinutes(message.minutes);
    if (minutes == null) {
      sendResponse({ ringsAt: null });
      return false;
    }
    stopAlarm(); // starting a new one silences one that is still ringing
    chrome.alarms
      .create(ALARM_NAME, { delayInMinutes: minutes })
      .then(() => chrome.alarms.get(ALARM_NAME))
      .then((alarm) => sendResponse({ ringsAt: alarm ? alarm.scheduledTime : null }));
    return true;
  } else if (message.type === 'alarm-cancel') {
    chrome.alarms
      .clear(ALARM_NAME)
      .then(() => stopAlarm())
      .then(() => sendResponse({}));
    return true;
  }
  return false;
});

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
