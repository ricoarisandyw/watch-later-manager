import * as store from '../lib/storage.js';

const status = document.getElementById('status');
const SETTING_KEYS = ['overrideWatchLater', 'autoOpenHome', 'promptOnFinish', 'keepHistory'];

function say(text, isError = false) {
  status.textContent = text;
  status.classList.toggle('error', isError);
}

async function loadSettings() {
  const settings = await store.getSettings();
  for (const key of SETTING_KEYS) {
    const box = document.getElementById(key);
    box.checked = Boolean(settings[key]);
    box.addEventListener('change', async () => {
      await store.setSettings({ [key]: box.checked });
      say('Saved.');
      if (key === 'keepHistory') showHistoryCount();
    });
  }
}

async function showHistoryCount() {
  const { count, keep } = await store.historyInfo();
  document.getElementById('history-count').textContent =
    `${count.toLocaleString()} event${count === 1 ? '' : 's'} stored` +
    (keep ? '.' : '. History is switched off, so nothing new is being recorded.');
}

document.getElementById('clear-history').addEventListener('click', async () => {
  const { count } = await store.historyInfo();
  if (!count) return say('There is no history to clear.');
  if (!confirm(`Delete your whole history (${count.toLocaleString()} events)? Your saved videos are not touched. Export first if you want a copy.`)) return;
  await store.clearHistory();
  await showHistoryCount();
  say('History cleared.');
});

document.getElementById('export').addEventListener('click', async () => {
  const json = await store.exportJson();
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `my-watch-later-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  say('Exported. Check your downloads folder.');
});

const fileInput = document.getElementById('file');
document.getElementById('import').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files && fileInput.files[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const { added, already, invalid, events } = await store.importJson(await file.text());
    say(
      `Imported ${added} new video${added === 1 ? '' : 's'}` +
        (already ? `, ${already} already in your list` : '') +
        (invalid ? `, ${invalid} skipped (not valid)` : '') +
        (events ? `, and ${events.toLocaleString()} history events` : '') +
        '.',
    );
    showHistoryCount();
  } catch (err) {
    say(err.message || 'Could not import that file.', true);
  }
});

document.getElementById('clear').addEventListener('click', async () => {
  const total = (await store.listVideos()).length;
  if (!total) return say('Nothing to delete.');
  if (!confirm(`Delete all ${total} saved videos? Export first if you want a copy.`)) return;
  await store.clearAll();
  showHistoryCount();
  say('All saved videos deleted. (They are logged in your history as removed.)');
});

// Backfill first, so the count already includes the videos you had before history existed.
store
  .ensureBackfill()
  .catch(() => {})
  .then(() => {
    loadSettings();
    showHistoryCount();
  });
