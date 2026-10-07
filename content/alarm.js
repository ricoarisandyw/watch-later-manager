// The alarm box inside the "Saved in My Watch Later" notice. It has three faces:
//   choices   2 / 3 / 5 minute buttons fill the time box, Start begins
//   running   a countdown, with Cancel
//   ringing   "Time's up", with Stop. It stays until you press Stop (nothing else sends you back to the choices).
// A page can't use chrome.alarms, so it asks the background script, which owns the alarm and rings it.
import { PRESET_MINUTES, formatRemaining, parseCustomMinutes } from '../lib/alarm.js';
import { h } from './dom.js';

const ask = (message) => chrome.runtime.sendMessage(message).catch(() => null); // null: extension was reloaded

export function createAlarmWidget() {
  let ringsAt = null; // when the running alarm goes off (ms), or null when there is none
  let ringStart = null; // when the alarm went off and is ringing now (ms), or null
  const root = h('div', { class: 'toast-alarm' });
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
    render();
    const reply = await ask({ type: 'alarm-start', minutes });
    if (reply && reply.ringsAt) {
      ringsAt = reply.ringsAt;
    } else {
      ringsAt = null; // nobody answered: most likely the extension was reloaded after this page opened
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

  const idle = h(
    'div',
    {},
    h('div', { class: 'alarm-title', text: '⏰ Alarm' }),
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
    {},
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
          render();
        },
      }),
    ),
  );
  const ringing = h(
    'div',
    {},
    h('div', { class: 'alarm-title', text: '⏰ Alarm' }),
    h(
      'div',
      { class: 'alarm-row' },
      h('div', { class: 'alarm-left', text: "Time's up!" }),
      h('button', {
        type: 'button',
        class: 'alarm-chip solid',
        text: '■ Stop',
        onclick: async () => {
          await ask({ type: 'alarm-stop' });
          ringStart = null; // now the choices come back
          render();
        },
      }),
    ),
  );
  root.append(idle, running, ringing);

  function render() {
    if (ringsAt != null && ringsAt <= Date.now()) {
      ringStart = ringsAt; // it went off
      ringsAt = null;
    }
    idle.hidden = ringsAt != null || ringStart != null;
    running.hidden = ringsAt == null;
    ringing.hidden = ringStart == null;
    if (ringsAt != null) left.textContent = formatRemaining(ringsAt - Date.now());
  }

  render();
  ask({ type: 'alarm-get' }).then((reply) => {
    if (ringsAt != null || ringStart != null) return; // you already started one, or it already went off
    ringsAt = (reply && reply.ringsAt) || null;
    ringStart = reply && !reply.ringsAt && reply.ringing ? Date.now() : null;
    render();
  });

  // Keep the countdown moving for as long as the notice is on screen.
  let seen = false;
  const timer = setInterval(() => {
    if (!root.isConnected) {
      if (seen) clearInterval(timer);
      return;
    }
    seen = true;
    render();
  }, 500);

  return root;
}
