import { ALARM_NAME, formatRemaining, parseCustomMinutes } from '../lib/alarm.js';
import { LISTS } from '../lib/model.js';
import { listVideos } from '../lib/storage.js';
import { hydrateIcons } from '../lib/icons.js';

hydrateIcons(document);

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

// ---------- alarm ----------

const $ = (id) => document.getElementById(id);
let tick = null;

async function showAlarm() {
  clearInterval(tick);
  const alarm = await chrome.alarms.get(ALARM_NAME);
  $('alarm-idle').hidden = Boolean(alarm);
  $('alarm-running').hidden = !alarm;
  if (!alarm) return;
  const update = () => {
    const left = alarm.scheduledTime - Date.now();
    $('alarm-left').textContent = formatRemaining(left);
    if (left <= 0) showAlarm(); // it just rang: back to the choices
  };
  update();
  tick = setInterval(update, 500);
}

async function startAlarm(minutes) {
  $('alarm-error').hidden = true;
  await chrome.alarms.create(ALARM_NAME, { delayInMinutes: minutes });
  showAlarm();
}

for (const btn of document.querySelectorAll('.alarm-preset')) {
  btn.addEventListener('click', () => startAlarm(Number(btn.dataset.min)));
}
$('alarm-custom').addEventListener('submit', (evt) => {
  evt.preventDefault();
  const minutes = parseCustomMinutes($('alarm-minutes').value);
  if (minutes == null) {
    $('alarm-error').hidden = false;
    return;
  }
  startAlarm(minutes);
});
$('alarm-cancel').addEventListener('click', async () => {
  await chrome.alarms.clear(ALARM_NAME);
  showAlarm();
});

document.getElementById('open').addEventListener('click', openList);
document.getElementById('options').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
showCounts();
showAlarm();
