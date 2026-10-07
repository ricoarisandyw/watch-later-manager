import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRemaining, parseCustomMinutes } from '../lib/alarm.js';

test('parseCustomMinutes accepts whole and half minutes', () => {
  assert.equal(parseCustomMinutes('7'), 7);
  assert.equal(parseCustomMinutes(' 1.5 '), 1.5);
  assert.equal(parseCustomMinutes('2,5'), 2.5); // decimal comma
  assert.equal(parseCustomMinutes('4.3'), 4.5); // rounded to the nearest half
});

test('parseCustomMinutes rejects empty, non-numbers and out-of-range values', () => {
  for (const bad of ['', '  ', 'abc', '0', '0.4', '-3', '601', null, undefined, 'Infinity']) {
    assert.equal(parseCustomMinutes(bad), null, String(bad));
  }
  assert.equal(parseCustomMinutes('600'), 600);
});

test('formatRemaining counts down as m:ss, then h:mm:ss', () => {
  assert.equal(formatRemaining(5 * 60_000), '5:00');
  assert.equal(formatRemaining(272_400), '4:33'); // partial seconds round up
  assert.equal(formatRemaining(5_000), '0:05');
  assert.equal(formatRemaining(3_900_000), '1:05:00');
  assert.equal(formatRemaining(-50), '0:00');
});
