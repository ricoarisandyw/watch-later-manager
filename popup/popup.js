import { LISTS } from '../lib/model.js';
import { listVideos } from '../lib/storage.js';

async function showCounts() {
  const videos = await listVideos();
  document.getElementById('count-wl').textContent = String(
    videos.filter((v) => v.list === LISTS.WATCH_LATER).length,
  );
  document.getElementById('count-rewatch').textContent = String(
    videos.filter((v) => v.list === LISTS.REWATCH).length,
  );
}

async function openList() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.id != null && (tab.url || '').startsWith('https://www.youtube.com/')) {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'open-dialog' });
      window.close();
      return;
    } catch {
      // the page was opened before the extension was installed: fall through and open a fresh tab
    }
  }
  await chrome.tabs.create({ url: 'https://www.youtube.com/?mwl=1' });
  window.close();
}

document.getElementById('open').addEventListener('click', openList);
document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
showCounts();
