// The "📊 Stats" tab. Charts are plain SVG; text always wears the text colours and only the marks
// (bars, line, dots) carry the series colours: blue = added, orange = finished.
import {
  RANGES,
  backlogSeries,
  bestTimes,
  completionBreakdown,
  dayStart,
  finishRate,
  rangeBounds,
  seriesByPeriod,
  streak,
  summarize,
} from '../lib/events.js';
import { buildInsights } from '../lib/insights.js';
import { formatDate, formatTotalTime, totalDuration } from '../lib/filters.js';
import { LISTS } from '../lib/model.js';
import { MAX_EVENTS } from '../lib/events.js';
import { h, s } from './dom.js';

// Whole-number axis: at most 4 steps, ending on a round number. niceScale(7) -> { step: 2, top: 8 }.
export function niceScale(max) {
  const m = Math.max(1, max);
  const pow = 10 ** Math.floor(Math.log10(m));
  // the smallest round whole-number step that still gives 4 steps or fewer (so 100 -> 0, 50, 100)
  let step = 1;
  for (const candidate of [pow / 10, (pow / 10) * 2, (pow / 10) * 5, pow, pow * 2, pow * 5, pow * 10]) {
    if (candidate < 1) continue;
    step = candidate;
    if (m / step <= 4) break;
  }
  return { step, top: Math.ceil(m / step) * step };
}

// A bar with a rounded tip and a square foot on the baseline.
export function barPath(x, top, width, height, radius = 4) {
  if (height <= 0) return '';
  const r = Math.min(radius, width / 2, height);
  const base = top + height;
  return (
    `M${x},${base}L${x},${top + r}Q${x},${top} ${x + r},${top}` +
    `L${x + width - r},${top}Q${x + width},${top} ${x + width},${top + r}L${x + width},${base}Z`
  );
}

const fmt = (ms, opts) => new Date(ms).toLocaleDateString(undefined, opts);
const periodLabel = (start, step) =>
  step === 'month'
    ? fmt(start, { month: 'long', year: 'numeric' })
    : step === 'week'
      ? `Week of ${fmt(start, { month: 'short', day: 'numeric' })}`
      : fmt(start, { weekday: 'short', month: 'short', day: 'numeric' });
const axisLabel = (start, step) =>
  step === 'month' ? fmt(start, { month: 'short', year: '2-digit' }) : fmt(start, { month: 'short', day: 'numeric' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pct = (r) => (r == null ? '–' : `${Math.round(r * 100)}%`);

// ---------- small pieces ----------

function tile(label, value, sub) {
  return h(
    'div',
    { class: 'st-tile' },
    h('div', { class: 'st-tile-label', text: label }),
    h('div', { class: 'st-tile-value', text: String(value) }),
    sub ? h('div', { class: 'st-tile-sub', text: sub }) : null,
  );
}

function tooltip(wrap) {
  const tip = h('div', { class: 'st-tip', hidden: true });
  wrap.append(tip);
  return {
    show(nodes, evt) {
      tip.replaceChildren(...nodes);
      tip.hidden = false;
      const box = wrap.getBoundingClientRect();
      const x = evt.clientX - box.left;
      const y = evt.clientY - box.top;
      tip.style.left = `${Math.max(4, Math.min(x + 14, box.width - tip.offsetWidth - 4))}px`;
      tip.style.top = `${Math.max(0, y - tip.offsetHeight - 12)}px`;
    },
    hide() {
      tip.hidden = true;
    },
  };
}

function tipLine(swatchClass, label, value) {
  return h(
    'div',
    { class: 'st-tip-row' },
    swatchClass ? h('i', { class: `sw ${swatchClass}` }) : null,
    h('span', { text: label }),
    h('strong', { text: String(value) }),
  );
}

// Every chart has a table version of the same numbers.
function tableView(headers, rows) {
  return h(
    'details',
    { class: 'st-table' },
    h('summary', { text: 'View as table' }),
    h(
      'div',
      { class: 'st-table-scroll' },
      h(
        'table',
        {},
        h('thead', {}, h('tr', {}, headers.map((t) => h('th', { text: t })))),
        h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', { text: String(c) }))))),
      ),
    ),
  );
}

function chartCard(title, subtitle, legend, body, table) {
  return h(
    'section',
    { class: 'st-card' },
    h('div', { class: 'st-card-head' }, h('div', {}, h('h3', { text: title }), h('p', { text: subtitle })), legend),
    body,
    table,
  );
}

// ---------- added vs finished ----------

function barChart(series, step) {
  const W = 720;
  const H = 230;
  const L = 40;
  const R = 10;
  const T = 14;
  const B = 26;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const { step: tick, top } = niceScale(Math.max(...series.map((p) => Math.max(p.added, p.finished)), 1));
  const y = (v) => T + plotH - (v / top) * plotH;
  const slot = plotW / series.length;
  const bw = Math.max(1.5, Math.min(24, (slot - 4) / 2 - 1)); // thin bars, never filling the slot
  const groupW = bw * 2 + 2; // the 2px surface gap between the pair

  const wrap = h('div', { class: 'st-chart' });
  const tip = tooltip(wrap);
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'st-svg',
    role: 'img',
    'aria-label': 'Videos added and finished over time. The same numbers are in the table below the chart.',
  });

  for (let v = 0; v <= top; v += tick) {
    svg.append(
      s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? 'baseline' : 'gridline' }),
      s('text', { x: L - 6, y: y(v) + 4, class: 'axis-text', 'text-anchor': 'end', text: v }),
    );
  }

  series.forEach((p, i) => {
    const x0 = L + i * slot;
    const gx = x0 + (slot - groupW) / 2;
    const hit = s('rect', { x: x0, y: T, width: slot, height: plotH, class: 'hit' });
    const show = (evt) =>
      tip.show(
        [
          h('div', { class: 'st-tip-title', text: periodLabel(p.start, step) }),
          tipLine('sw-added', 'Added', p.added),
          tipLine('sw-finished', 'Finished', p.finished),
        ],
        evt,
      );
    hit.addEventListener('mouseenter', show);
    hit.addEventListener('mousemove', show);
    hit.addEventListener('mouseleave', tip.hide);
    svg.append(hit);
    svg.append(
      s('path', { d: barPath(gx, y(p.added), bw, y(0) - y(p.added)), class: 'bar-added' }),
      s('path', { d: barPath(gx + bw + 2, y(p.finished), bw, y(0) - y(p.finished)), class: 'bar-finished' }),
    );
  });

  const marks = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])];
  for (const i of marks) {
    const cx = L + i * slot + slot / 2;
    const edge = i === 0 && series.length > 1 ? 'start' : i === series.length - 1 && series.length > 1 ? 'end' : 'middle';
    svg.append(
      s('text', {
        x: edge === 'start' ? L + i * slot : edge === 'end' ? L + (i + 1) * slot : cx,
        y: H - 6,
        class: 'axis-text',
        'text-anchor': edge,
        text: axisLabel(series[i].start, step),
      }),
    );
  }
  wrap.prepend(svg);
  return wrap;
}

// ---------- list size over time ----------

function lineChart(points) {
  const W = 720;
  const H = 210;
  const L = 40;
  const R = 16;
  const T = 24;
  const B = 26;
  const plotW = W - L - R;
  const plotH = H - T - B;
  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const { step: tick, top } = niceScale(Math.max(...points.map((p) => p.n), 1));
  const x = (t) => L + ((t - t0) / (t1 - t0)) * plotW;
  const y = (n) => T + plotH - (n / top) * plotH;
  const last = points[points.length - 1];

  const wrap = h('div', { class: 'st-chart' });
  const tip = tooltip(wrap);
  const svg = s('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: 'st-svg',
    role: 'img',
    'aria-label': `Number of videos waiting in your Watch Later list over time. It ends at ${last.n}.`,
  });
  for (let v = 0; v <= top; v += tick) {
    svg.append(
      s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: v === 0 ? 'baseline' : 'gridline' }),
      s('text', { x: L - 6, y: y(v) + 4, class: 'axis-text', 'text-anchor': 'end', text: v }),
    );
  }

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.n).toFixed(1)}`).join('');
  svg.append(
    s('path', { d: `${line}L${x(t1).toFixed(1)},${y(0)}L${x(t0).toFixed(1)},${y(0)}Z`, class: 'area-1' }),
    s('path', { d: line, class: 'line-1' }),
  );

  const crosshair = s('line', { y1: T, y2: y(0), class: 'crosshair', visibility: 'hidden' });
  const hoverDot = s('circle', { r: 5, class: 'dot-1', visibility: 'hidden' });
  svg.append(crosshair, hoverDot);
  svg.append(s('circle', { cx: x(last.t), cy: y(last.n), r: 5, class: 'dot-1' }));
  svg.append(
    s('text', {
      x: x(last.t) - 10,
      y: Math.max(T - 6, y(last.n) - 10),
      class: 'axis-text strong',
      'text-anchor': 'end',
      text: plural(last.n, 'video'),
    }),
  );

  const longSpan = t1 - t0 > 300 * 86_400_000;
  const dateLabel = (t) => fmt(t, longSpan ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });
  svg.append(
    s('text', { x: L, y: H - 6, class: 'axis-text', 'text-anchor': 'start', text: dateLabel(t0) }),
    s('text', { x: W - R, y: H - 6, class: 'axis-text', 'text-anchor': 'end', text: dateLabel(t1) }),
  );

  const area = s('rect', { x: L, y: T, width: plotW, height: plotH, class: 'hit-all' });
  const move = (evt) => {
    const box = svg.getBoundingClientRect();
    const sx = ((evt.clientX - box.left) * W) / box.width;
    let near = points[0];
    for (const p of points) if (Math.abs(x(p.t) - sx) < Math.abs(x(near.t) - sx)) near = p;
    crosshair.setAttribute('x1', x(near.t));
    crosshair.setAttribute('x2', x(near.t));
    crosshair.setAttribute('visibility', 'visible');
    hoverDot.setAttribute('cx', x(near.t));
    hoverDot.setAttribute('cy', y(near.n));
    hoverDot.setAttribute('visibility', 'visible');
    tip.show(
      [
        h('div', { class: 'st-tip-title', text: fmt(near.t, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) }),
        tipLine('sw-added', 'Waiting', near.n),
        near.sec ? tipLine(null, 'Time to watch', formatTotalTime(near.sec)) : null,
      ].filter(Boolean),
      evt,
    );
  };
  area.addEventListener('mousemove', move);
  area.addEventListener('mouseleave', () => {
    crosshair.setAttribute('visibility', 'hidden');
    hoverDot.setAttribute('visibility', 'hidden');
    tip.hide();
  });
  svg.append(area);
  wrap.prepend(svg);
  return wrap;
}

// ---------- horizontal bars for the breakdowns ----------

function hbars(title, note, rows) {
  return h(
    'section',
    { class: 'st-card st-mini' },
    h('h3', { text: title }),
    note ? h('p', { text: note }) : null,
    rows.length
      ? h(
          'div',
          { class: 'st-hbars' },
          rows.map((r) => {
            const fill = h('span', { class: 'st-hfill' });
            fill.style.width = `${Math.round(r.fill * 100)}%`; // set on the style object, not as an attribute
            return h(
              'div',
              { class: 'st-hrow', title: r.title || '' },
              h('span', { class: 'st-hlabel', text: r.label }),
              h('span', { class: 'st-htrack' }, fill),
              h('span', { class: 'st-hvalue', text: r.value }),
            );
          }),
        )
      : h('p', { class: 'st-none', text: 'Nothing to show yet.' }),
  );
}

// ---------- the tab ----------

// ctx = { videos, events, snapshots, range, includeImports, now, onRange(key), onImports(bool), onReview(cutoff) }
export function renderStats(ctx) {
  const { videos, events, snapshots, now } = ctx;
  const bounds = rangeBounds(ctx.range, events, now);
  const opts = { ...bounds, includeImports: ctx.includeImports };
  const root = h('div', { class: 'st' });

  root.append(
    h(
      'div',
      { class: 'st-head' },
      h(
        'div',
        { class: 'seg', role: 'group', 'aria-label': 'Time range' },
        RANGES.map((r) =>
          h('button', {
            type: 'button',
            class: `seg-btn${r.key === ctx.range ? ' active' : ''}`,
            text: r.label,
            onclick: () => ctx.onRange(r.key),
          }),
        ),
      ),
      h(
        'label',
        { class: 'st-check', title: 'Imported videos are saved in one go, so they would flatten the charts.' },
        h('input', { type: 'checkbox', checked: ctx.includeImports, onchange: (e) => ctx.onImports(e.target.checked) }),
        ' Include imported videos',
      ),
    ),
  );

  if (!events.length) {
    root.append(
      h(
        'div',
        { class: 'empty' },
        h('p', { text: 'No history yet.' }),
        h('p', {
          class: 'sub',
          text: 'Save a video and finish watching it, and your numbers will appear here. History can be switched off in Settings.',
        }),
      ),
    );
    return root;
  }

  // summary tiles
  const sum = summarize(events, opts);
  const rate = finishRate(events, ctx.includeImports);
  const waiting = videos.filter((v) => v.list === LISTS.WATCH_LATER);
  const total = totalDuration(waiting);
  const run = streak(events, now);
  const rangeLabel = (RANGES.find((r) => r.key === ctx.range) || RANGES[1]).label.toLowerCase();
  root.append(
    h(
      'div',
      { class: 'st-tiles' },
      tile('Added', sum.added, `in ${rangeLabel === 'all time' ? 'all time' : `the last ${rangeLabel}`}`),
      tile('Finished', sum.finished, 'videos that reached the end'),
      tile('Finish rate', pct(rate.rate), `${rate.finished} of ${rate.added} ever added`),
      tile('Thrown away', sum.removedUnwatched, 'removed without finishing'),
      tile('Waiting now', waiting.length, total.known ? `${formatTotalTime(total.seconds)} to watch` : ''),
      tile('Streak', plural(run.current, 'day'), `longest ${plural(run.longest, 'day')}`),
    ),
  );

  // added vs finished
  const series = seriesByPeriod(events, opts);
  const stepName = bounds.step === 'day' ? 'day' : bounds.step === 'week' ? 'week' : 'month';
  root.append(
    chartCard(
      'Added vs finished',
      `Videos per ${stepName}. Finished counts each video once.`,
      h(
        'div',
        { class: 'st-legend' },
        h('span', {}, h('i', { class: 'sw sw-added' }), ' Added'),
        h('span', {}, h('i', { class: 'sw sw-finished' }), ' Finished'),
      ),
      barChart(series, bounds.step),
      tableView(
        [bounds.step === 'day' ? 'Day' : bounds.step === 'week' ? 'Week of' : 'Month', 'Added', 'Finished'],
        series.map((p) => [periodLabel(p.start, bounds.step), p.added, p.finished]),
      ),
    ),
  );

  // list size over time: the daily snapshots, plus today's live number
  const live = { t: dayStart(now), n: waiting.length, sec: total.seconds };
  const points = [...backlogSeries(snapshots, bounds).filter((p) => p.t !== live.t), live].sort((a, b) => a.t - b.t);
  root.append(
    chartCard(
      'List size over time',
      'Videos waiting in Watch Later, once per day.',
      null,
      points.length >= 2
        ? lineChart(points)
        : h('p', { class: 'st-none', text: 'Needs at least two days of history. Come back tomorrow.' }),
      points.length >= 2
        ? tableView(
            ['Day', 'Videos waiting', 'Time to watch'],
            points.map((p) => [fmt(p.t, { year: 'numeric', month: 'short', day: 'numeric' }), p.n, p.sec ? formatTotalTime(p.sec) : '–']),
          )
        : null,
    ),
  );

  // insights
  const insights = buildInsights({ videos, events, now, includeImports: ctx.includeImports });
  root.append(
    h(
      'section',
      { class: 'st-card' },
      h('h3', { text: 'Insights' }),
      h(
        'ul',
        { class: 'st-insights' },
        insights.map((i) =>
          h(
            'li',
            { class: `st-insight tone-${i.tone}` },
            h('span', { class: 'st-icon', text: i.icon, 'aria-hidden': 'true' }),
            h('span', { class: 'st-text', text: i.text }),
            i.action
              ? h('button', {
                  type: 'button',
                  class: 'btn small',
                  text: i.action.label,
                  onclick: () => ctx.onReview(i.action.cutoff),
                })
              : null,
          ),
        ),
      ),
    ),
  );

  // what you finish, and when
  const byLength = completionBreakdown(events, { by: 'length', includeImports: ctx.includeImports });
  const byChannel = completionBreakdown(events, { by: 'channel', includeImports: ctx.includeImports }).slice(0, 8);
  const times = bestTimes(events);
  const peak = Math.max(...times.byWeekday, 1);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const rateRow = (r) => ({
    label: r.label,
    fill: r.rate,
    value: `${pct(r.rate)} · ${r.finished}/${r.added}`,
    title: `${r.finished} of ${r.added} finished`,
  });
  root.append(
    h(
      'div',
      { class: 'st-minis' },
      hbars('Finish rate by length', 'Share of saved videos you finished.', byLength.map(rateRow)),
      hbars('Channels you save most', 'Top 8 by videos saved.', byChannel.map(rateRow)),
      hbars(
        'When you finish',
        'Finished videos by weekday.',
        times.byWeekday.map((n, i) => ({ label: days[i], fill: n / peak, value: String(n), title: `${n} finished` })),
      ),
    ),
  );

  const first = Math.min(...events.map((e) => e.t));
  root.append(
    h('p', {
      class: 'st-foot',
      text: `History: ${events.length.toLocaleString()} events since ${formatDate(first)} (the latest ${MAX_EVENTS.toLocaleString()} are kept). Manage it in Settings.`,
    }),
  );
  return root;
}
