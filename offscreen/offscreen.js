// A service worker can't play sound, so the alarm rings from this hidden page. The beeps are generated
// here (no audio file to ship): three short beeps, a pause, repeated for about 20 seconds.
const BEEP_SEC = 0.18;
const BEEPS_PER_ROUND = 3;
const ROUND_SEC = 1.6;
const ROUNDS = 12;

let ctx = null;

function ring() {
  stop();
  ctx = new AudioContext();
  for (let round = 0; round < ROUNDS; round += 1) {
    for (let beep = 0; beep < BEEPS_PER_ROUND; beep += 1) {
      const start = ctx.currentTime + round * ROUND_SEC + beep * (BEEP_SEC + 0.12);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.4, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + BEEP_SEC);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + BEEP_SEC + 0.02);
    }
  }
  setTimeout(() => chrome.runtime.sendMessage({ type: 'alarm-sound-done' }).catch(() => {}), ROUNDS * ROUND_SEC * 1000);
}

function stop() {
  if (ctx) ctx.close().catch(() => {});
  ctx = null;
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'alarm-ring') ring();
  if (message && message.type === 'alarm-stop') stop();
});
