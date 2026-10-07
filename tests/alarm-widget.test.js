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
    this.classList = { toggle() {} };
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
globalThis.document = { createElement: (tag) => new FakeEl(tag), createElementNS: (_n, tag) => new FakeEl(tag) };

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
// which of the three faces is showing
const face = (root) => {
  const [idle, running, ringing] = root.children;
  return [idle, running, ringing].map((p) => !p.hidden).join() === 'true,false,false'
    ? 'choices'
    : [idle, running, ringing].map((p) => !p.hidden).join() === 'false,true,false'
      ? 'running'
      : [idle, running, ringing].map((p) => !p.hidden).join() === 'false,false,true'
        ? 'ringing'
        : `mixed(${[idle, running, ringing].map((p) => !p.hidden)})`;
};
const tick = async (ms) => {
  for (let t = 0; t < ms; t += 500) {
    now += 500;
    for (const fn of timers) fn();
    await new Promise((r) => setImmediate(r));
  }
};

test('the alarm shows the choices again only after Stop, never by itself', async () => {
  const root = createAlarmWidget();
  root.isConnected = true;
  await tick(500);
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

  await tick(10 * 60_000); // ten minutes of nobody pressing Stop
  assert.equal(face(root), 'ringing');

  await click(button(root, '■ Stop'));
  assert.equal(face(root), 'choices');
});

test('a box opened while the alarm still needs Stop (next video, reloaded tab) shows Stop, not the choices', async () => {
  bg.alarmAt = now - 1000; // went off a moment ago and nobody has pressed Stop
  const root = createAlarmWidget();
  root.isConnected = true;
  await tick(500);
  assert.equal(face(root), 'ringing');
  await click(button(root, '■ Stop'));
  assert.equal(face(root), 'choices');
  const again = createAlarmWidget();
  again.isConnected = true;
  await tick(500);
  assert.equal(face(again), 'choices'); // and it stays stopped
});
