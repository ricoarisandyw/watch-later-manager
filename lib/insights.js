// Turns the history into the plain-language sentences on the Stats tab.
// Pure, so every sentence can be checked in a unit test.
import {
  bestTimes,
  clearEta,
  completionBreakdown,
  formatSpan,
  graveyard,
  paceStats,
  rewatchRate,
  streak,
  timeToFinish,
} from './events.js';
import { formatTotalTime } from './filters.js';
import { LISTS } from './model.js';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const num = (n) => String(Math.round(n * 10) / 10);
const pct = (r) => `${Math.round(r * 100)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const GRAVEYARD_DAYS = 90;

// Returns [{ key, icon, tone, text, action? }]. tone: 'good' | 'warn' | 'normal' | 'muted'.
// Not enough data never produces a made-up number: it produces a "muted" sentence saying so.
export function buildInsights({ videos, events, now = Date.now(), includeImports = false }) {
  const out = [];
  const add = (key, icon, tone, text, action) => out.push({ key, icon, tone, text, ...(action ? { action } : {}) });
  const waiting = videos.filter((v) => v.list === LISTS.WATCH_LATER);

  // pace and "will I ever clear this list?"
  const pace = paceStats(events, now);
  if (pace.addedPerWeek > 0 || pace.finishedPerWeek > 0) {
    add(
      'pace',
      'zap',
      'normal',
      `In the last ${formatSpan(pace.sampleDays)} you added ${num(pace.addedPerWeek)} and finished ${num(pace.finishedPerWeek)} videos per week.`,
    );
    const eta = clearEta({
      backlog: waiting.length,
      addedPerWeek: pace.addedPerWeek,
      finishedPerWeek: pace.finishedPerWeek,
    });
    if (eta.status === 'clearing') {
      const days = eta.weeks * 7;
      add(
        'eta',
        'flag',
        days > 365 ? 'warn' : 'good',
        `At this pace your ${plural(waiting.length, 'video')} would be cleared in about ${formatSpan(days)}.`,
      );
    } else if (eta.status === 'growing') {
      add(
        'eta',
        'trending-up',
        eta.perWeek > 0 ? 'warn' : 'normal',
        eta.perWeek > 0
          ? `You add more than you finish, so your list grows by about ${num(eta.perWeek)} videos each week.`
          : 'You add about as many as you finish, so your list stays about the same size.',
      );
    } else if (eta.status === 'stalled') {
      add('eta', 'octagon-x', 'muted', "You haven't finished a video in this period, so there is no pace to estimate yet.");
    } else {
      add('eta', 'check-circle', 'good', 'Your list is empty. Nothing left to clear!');
    }
    if (pace.secAddedPerWeek > 0 || pace.secFinishedPerWeek > 0) {
      add(
        'hours',
        'timer',
        pace.secAddedPerWeek > pace.secFinishedPerWeek ? 'warn' : 'good',
        `Each week you add about ${formatTotalTime(pace.secAddedPerWeek)} of video and finish about ${formatTotalTime(pace.secFinishedPerWeek)}.`,
      );
    }
  } else {
    add('pace', 'hourglass', 'muted', 'Not enough activity yet. Save and finish a few videos and your pace shows up here.');
  }

  // how long videos wait
  const wait = timeToFinish(events);
  add(
    'wait',
    'clock',
    wait.count >= 3 ? 'normal' : 'muted',
    wait.count >= 3
      ? `Videos wait a median of ${formatSpan(wait.medianDays)} before you finish them (average ${formatSpan(wait.avgDays)}).`
      : 'Finish at least 3 videos to see how long they usually wait.',
  );

  // old and never finished
  const grave = graveyard(videos, events, now, GRAVEYARD_DAYS);
  if (grave.count > 0) {
    add(
      'graveyard',
      'archive',
      'warn',
      `${plural(grave.count, 'video')} in your list ${grave.count === 1 ? 'has' : 'have'} been waiting more than ${GRAVEYARD_DAYS} days and you never finished ${grave.count === 1 ? 'it' : 'them'}.`,
      { id: 'review', label: 'Review in list', cutoff: grave.cutoff },
    );
  } else {
    add('graveyard', 'sprout', 'good', `Nothing in your list has waited more than ${GRAVEYARD_DAYS} days.`);
  }

  // what you actually finish
  const byLength = completionBreakdown(events, { by: 'length', includeImports }).filter(
    (r) => r.added >= 3 && r.label !== 'Unknown length',
  );
  if (byLength.length >= 2) {
    const best = byLength.reduce((a, b) => (b.rate > a.rate ? b : a));
    const worst = byLength.reduce((a, b) => (b.rate < a.rate ? b : a));
    add(
      'length',
      'ruler',
      'normal',
      best.rate - worst.rate < 0.1
        ? 'You finish videos of every length at a similar rate.'
        : `You finish ${pct(best.rate)} of your “${best.label}” videos but only ${pct(worst.rate)} of your “${worst.label}” ones.`,
    );
  } else {
    add('length', 'ruler', 'muted', 'Save a few more videos of different lengths to see which ones you finish.');
  }

  const byChannel = completionBreakdown(events, { by: 'channel', includeImports }).filter(
    (r) => r.added >= 3 && r.label !== 'Unknown',
  );
  if (byChannel.length >= 2) {
    const best = byChannel.reduce((a, b) => (b.rate > a.rate ? b : a));
    const worst = byChannel.reduce((a, b) => (b.rate < a.rate ? b : a));
    add(
      'channel',
      'tv',
      'normal',
      best.rate === worst.rate
        ? 'You finish videos from your top channels at a similar rate.'
        : `You finish most videos from ${best.label} (${best.finished} of ${best.added}) and fewest from ${worst.label} (${worst.finished} of ${worst.added}).`,
    );
  }

  // when you finish things
  const times = bestTimes(events);
  if (times.total >= 5) {
    const day = times.byWeekday.indexOf(Math.max(...times.byWeekday));
    const hour = times.byHour.indexOf(Math.max(...times.byHour));
    add('time', 'calendar', 'normal', `Most of your finishes happen on ${WEEKDAYS[day]}s, around ${String(hour).padStart(2, '0')}:00.`);
  } else {
    add('time', 'calendar', 'muted', 'Finish at least 5 videos to see when you watch the most.');
  }

  const run = streak(events, now);
  add(
    'streak',
    'flame',
    run.current >= 3 ? 'good' : run.longest ? 'normal' : 'muted',
    run.longest
      ? `Current streak: ${plural(run.current, 'day')} in a row (longest ever: ${run.longest}).`
      : 'Finish a video to start a streak.',
  );

  const again = rewatchRate(events);
  if (again.finished >= 3) {
    add(
      'rewatch',
      'repeat',
      'normal',
      `${pct(again.rate)} of the videos you finished went to Should Rewatch (${again.toRewatch} of ${again.finished}).`,
    );
  }
  return out;
}
