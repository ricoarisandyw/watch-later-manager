// The alarm pill, bottom right above the "My Watch Later" button. It lives on its own, so answering or leaving
// the "Saved in My Watch Later" notice never takes it away. It has four faces:
//   idle      a small ⏰ button (nothing is set)
//   choices   2 / 3 / 5 minute buttons fill the time box, Start begins
//   running   a countdown, with Cancel
//   ringing   "Time's up!", with Stop and +5 min. It stays until you deal with it.
// A page can't use chrome.alarms, so it asks the background script, which owns the alarm and rings it.
import { PRESET_MINUTES, formatRemaining, parseCustomMinutes } from '../lib/alarm.js';
import { h } from './dom.js';

const ask = (message) => chrome.runtime.sendMessage(message).catch(() => null); // null: extension was reloaded

const SNOOZE_MINUTES = 5;
const RINGING_TITLE = "⏰ Time's up! ";
const SYNC_MS = 4000; // how often a running or ringing alarm is checked against the background script
const SYNC_GRACE_MS = 3000; // the background script needs a moment to note that the alarm rang

export function createAlarmWidget() {
  let ringsAt = null; // when the running alarm goes off (ms), or null when there is none
  let ringStart = null; // when the alarm went off and is ringing now (ms), or null
  let open = false; // the choices are showing instead of the small button
  let starting = false; // a start request is on its way, so ignore what the background says until it answers
  let lastSync = 0;
  const root = h('div', { class: 'alarm-pill' });
  const left = h('div', { class: 'alarm-left', text: '0:00' });
  const error = h('div', { class: 'alarm-error', hidden: true });
  const showError = (text) => {
    error.textContent = text;
    error.hidden = false;
  };
  const input = h('input', {
    class: 'alarm-input',
    type: 'text',
    inputmode: 'decimal',
    placeholder: 'Custom',
    autocomplete: 'off',
    'aria-label': 'Custom minutes',
  });

  const start = async (minutes) => {
    error.hidden = true;
    ringStart = null;
    ringsAt = Date.now() + minutes * 60_000; // show the countdown at once; the reply below makes it exact
    starting = true;
    render();
    const reply = await ask({ type: 'alarm-start', minutes });
    starting = false;
    if (reply && reply.ringsAt) {
      ringsAt = reply.ringsAt;
    } else {
      ringsAt = null; // nobody answered: most likely the extension was reloaded after this page opened
      open = true;
      showError("Couldn't start the alarm. Reload this YouTube page and try again.");
    }
    render();
  };
  const startCustom = () => {
    const minutes = parseCustomMinutes(input.value);
    if (minutes == null) showError('Enter 1 to 600 minutes.');
    else start(minutes);
  };
  // the 2 / 3 / 5 buttons light up while the box holds their number
  const chips = PRESET_MINUTES.map((m) =>
    h('button', {
      type: 'button',
      class: 'alarm-chip',
      text: `${m} min`,
      onclick: () => {
        input.value = String(m);
        error.hidden = true;
        markChips();
        input.focus();
      },
    }),
  );
  const markChips = () => {
    const typed = parseCustomMinutes(input.value);
    chips.forEach((chip, i) => chip.classList.toggle('on', typed === PRESET_MINUTES[i]));
  };
  input.addEventListener('input', markChips);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      startCustom();
    }
  });

  const idle = h('button', {
    type: 'button',
    class: 'alarm-bell',
    text: '⏰',
    title: 'Set an alarm',
    'aria-label': 'Set an alarm',
    onclick: () => {
      open = true;
      render();
      input.focus();
    },
  });
  const choices = h(
    'div',
    { class: 'alarm-face' },
    h(
      'div',
      { class: 'alarm-head' },
      h('div', { class: 'alarm-title', text: '⏰ Alarm' }),
      h('button', {
        type: 'button',
        class: 'alarm-close',
        text: '✕',
        title: 'Close',
        'aria-label': 'Close',
        onclick: () => {
          open = false;
          error.hidden = true;
          render();
        },
      }),
    ),
    h(
      'div',
      { class: 'alarm-row' },
      chips,
      input,
      h('span', { class: 'alarm-unit', text: 'min' }),
      h('button', { type: 'button', class: 'alarm-chip solid', text: 'Start', onclick: startCustom }),
    ),
    error,
  );
  const running = h(
    'div',
    { class: 'alarm-face' },
    h('div', { class: 'alarm-title', text: '⏰ Alarm rings in' }),
    h(
      'div',
      { class: 'alarm-row' },
      left,
      h('button', {
        type: 'button',
        class: 'alarm-chip quiet',
        text: 'Cancel',
        onclick: async () => {
          await ask({ type: 'alarm-cancel' });
          ringsAt = null;
          open = false;
          render();
        },
      }),
    ),
  );
  const ringing = h(
    'div',
    { class: 'alarm-face' },
    h('div', { class: 'alarm-title', text: "⏰ Time's up!" }),
    h(
      'div',
      { class: 'alarm-row' },
      h('button', {
        type: 'button',
        class: 'alarm-chip solid',
        text: '■ Stop',
        onclick: async () => {
          await ask({ type: 'alarm-stop' });
          ringStart = null;
          open = false; // back to the small button, not to the choices
          render();
        },
      }),
      h('button', {
        type: 'button',
        class: 'alarm-chip',
        text: `+${SNOOZE_MINUTES} min`,
        onclick: () => start(SNOOZE_MINUTES),
      }),
    ),
  );
  root.append(idle, choices, running, ringing);

  // the tab title carries the news too, for when you are on another tab
  const markTitle = (on) => {
    const marked = document.title.startsWith(RINGING_TITLE);
    if (on && !marked) document.title = RINGING_TITLE + document.title;
    else if (!on && marked) document.title = document.title.slice(RINGING_TITLE.length);
  };

  function render() {
    if (ringsAt != null && ringsAt <= Date.now()) {
      ringStart = ringsAt; // it went off
      ringsAt = null;
    }
    const isRunning = ringsAt != null;
    const isRinging = ringStart != null;
    idle.hidden = isRunning || isRinging || open;
    choices.hidden = isRunning || isRinging || !open;
    running.hidden = !isRunning;
    ringing.hidden = !isRinging;
    root.classList.toggle('ringing', isRinging);
    root.classList.toggle('big', isRunning || isRinging || open);
    markTitle(isRinging);
    if (isRunning) left.textContent = formatRemaining(ringsAt - Date.now());
  }

  // Take the background script's word for what is set: another tab or the toolbar popup may have changed it.
  async function sync() {
    lastSync = Date.now();
    const reply = await ask({ type: 'alarm-get' });
    if (!reply || starting) return;
    if (reply.ringsAt) {
      ringsAt = reply.ringsAt;
      ringStart = null;
    } else if (reply.ringing) {
      ringsAt = null;
      ringStart ??= Date.now();
    } else {
      ringsAt = null;
      if (ringStart != null && Date.now() - ringStart > SYNC_GRACE_MS) ringStart = null; // stopped elsewhere
    }
    render();
  }

  render();
  sync();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
  });

  // Keep the countdown moving, and check now and then that it is still what the background script has.
  setInterval(() => {
    if (!root.isConnected) return; // not on screen yet (or the page was switched off)
    render();
    if ((ringsAt != null || ringStart != null) && Date.now() - lastSync >= SYNC_MS) sync();
  }, 500);

  return root;
}
