import test from 'node:test';
import assert from 'node:assert/strict';

// A very small stand-in for the browser DOM, a clock we control, and a fake background script.
class FakeEl {
  constructor(tag) {
    this.tagName = tag;
    this.attrs = {};
    this.children = [];
    this.listeners = {};
    this.className = '';
    this._text = '';
    this.value = '';
    this.hidden = false;
    this.isConnected = false;
    this.classList = { toggle: (name, on) => (this.classes ||= new Map()).set(name, Boolean(on)) };
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'hidden') this.hidden = true;
  }
  append(...kids) {
    for (const k of kids) this.children.push(typeof k === 'string' ? { text: k } : k);
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  focus() {}
  set textContent(v) {
    this._text = String(v);
  }
  get textContent() {
    return this._text;
  }
}
const docListeners = {};
globalThis.document = {
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (_n, tag) => new FakeEl(tag),
  addEventListener: (type, fn) => (docListeners[type] ||= []).push(fn),
  visibilityState: 'visible',
  title: 'Some video - YouTube',
};

let now = 1_000_000;
Date.now = () => now;
const timers = [];
globalThis.setInterval = (fn) => timers.push(fn) && timers.length;
globalThis.clearInterval = () => {};

// the background script: owns one alarm; "rings" when its time comes
const bg = { alarmAt: null, ringing: false };
globalThis.chrome = {
  runtime: {
    sendMessage: async (m) => {
      if (bg.alarmAt != null && bg.alarmAt <= now) {
        bg.alarmAt = null;
        bg.ringing = true;
      }
      if (m.type === 'alarm-get') return { ringsAt: bg.alarmAt, ringing: bg.ringing };
      if (m.type === 'alarm-start') {
        bg.ringing = false;
        bg.alarmAt = now + m.minutes * 60_000;
        return { ringsAt: bg.alarmAt };
      }
      if (m.type === 'alarm-stop') {
        bg.ringing = false;
        return {};
      }
      if (m.type === 'alarm-cancel') {
        bg.alarmAt = null;
        return {};
      }
      return undefined;
    },
  },
};

const { createAlarmWidget } = await import('../content/alarm.js');

const walk = (n, out = []) => (out.push(n), (n.children || []).forEach((c) => walk(c, out)), out);
const button = (root, label) => walk(root).find((n) => n.tagName === 'button' && n._text === label);
const click = async (el) => {
  for (const fn of el.listeners.click) await fn();
};
// which of the faces is showing: the root holds the small button, the choices, the countdown and the ringing face
const face = (root) => {
  const [idle, choices, running, ringing] = root.children;
  const shown = [idle, choices, running, ringing].map((p) => !p.hidden);
  const names = ['idle', 'choices', 'running', 'ringing'];
  assert.equal(shown.filter(Boolean).length, 1, `exactly one face at a time, got ${shown}`);
  return names[shown.indexOf(true)];
};
const tick = async (ms) => {
  for (let t = 0; t < ms; t += 500) {
    now += 500;
    for (const fn of timers) fn();
    await new Promise((r) => setImmediate(r));
  }
};
const reset = () => {
  bg.alarmAt = null;
  bg.ringing = false;
  document.title = 'Some video - YouTube';
};

test('the alarm is a small button until you open it, and goes back to one after Stop, never by itself', async () => {
  reset();
  const root = createAlarmWidget();
  root.isConnected = true;
  await tick(500);
  assert.equal(face(root), 'idle');

  await click(walk(root).find((n) => n.tagName === 'button' && n.attrs['aria-label'] === 'Set an alarm'));
  assert.equal(face(root), 'choices');

  await click(button(root, '2 min'));
  await click(button(root, 'Start'));
  assert.equal(face(root), 'running');

  await tick(60_000);
  assert.equal(face(root), 'running');
  await tick(59_000);
  assert.equal(face(root), 'running');
  await tick(1_000); // 2:00 is up
  assert.equal(face(root), 'ringing');
  assert.match(document.title, /^⏰ Time's up! Some video/);

  await tick(10 * 60_000); // ten minutes of nobody pressing Stop
  assert.equal(face(root), 'ringing');

  await click(button(root, '■ Stop'));
  assert.equal(face(root), 'idle');
  assert.equal(document.title, 'Some video - YouTube');
});

test('Cancel puts the small button back', async () => {
  reset();
  const root = createAlarmWidget();
  root.isConnected = true;
  await tick(500);
  bg.alarmAt = now + 60_000;
  docListeners.visibilitychange.forEach((fn) => fn()); // you come back to this tab: it notices the alarm set elsewhere
  await tick(500);
  assert.equal(face(root), 'running');
  await click(button(root, 'Cancel'));
  assert.equal(face(root), 'idle');
});

test('+5 min while ringing silences it and starts a new countdown', async () => {
  reset();
  bg.alarmAt = now - 1000;
  const root = createAlarmWidget();
  root.isConnected = true;
  await tick(500);
  assert.equal(face(root), 'ringing');
  await click(button(root, '+5 min'));
  assert.equal(face(root), 'running');
  assert.equal(bg.ringing, false);
  assert.equal(document.title, 'Some video - YouTube');
});

test('a box opened while the alarm still needs Stop (next video, reloaded tab) shows Stop, not the button', async () => {
  reset();
  bg.alarmAt = now - 1000; // went off a moment ago and nobody has pressed Stop
  const root = createAlarmWidget();
  root.isConnected = true;
  await tick(500);
  assert.equal(face(root), 'ringing');
  await click(button(root, '■ Stop'));
  assert.equal(face(root), 'idle');
  const again = createAlarmWidget();
  again.isConnected = true;
  await tick(500);
  assert.equal(face(again), 'idle'); // and it stays stopped
});

test('a ringing pill clears itself when the alarm was stopped somewhere else', async () => {
  reset();
  bg.alarmAt = now - 1000;
  const root = createAlarmWidget();
  root.isConnected = true;
  await tick(500);
  assert.equal(face(root), 'ringing');
  bg.ringing = false; // stopped from the notification
  await tick(8_000);
  assert.equal(face(root), 'idle');
});
