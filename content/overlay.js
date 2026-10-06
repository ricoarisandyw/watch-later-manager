import {
  LISTS,
  normalizeTag,
  parseDuration,
  parseRelativeAge,
  parseVideoId,
  parseViews,
  watchUrl,
} from '../lib/model.js';
import {
  DATE_PRESETS,
  DURATION_BUCKETS,
  SORT_OPTIONS,
  VIEW_BUCKETS,
  applyFilters,
  customRange,
  dataCoverage,
  formatDate,
  formatDays,
  formatDuration,
  formatHours,
  formatTotalTime,
  formatViews,
  sortVideos,
  totalDuration,
  uniqueChannels,
  uniqueTags,
} from '../lib/filters.js';
import { fetchVideoMeta } from '../lib/metadata.js';
import * as store from '../lib/storage.js';
import { loadAll, removeAll } from './native-wl.js';
import { h } from './dom.js';
import { renderStats } from './stats.js';
import { EVENT, dayKey, eventFor, makeEvent } from '../lib/events.js';

// The four "range" filters. Each one has presets plus a "Custom range…" where you type the values.
const RANGE_KINDS = [
  { key: 'duration', label: 'Length', presets: DURATION_BUCKETS, input: 'number', unit: 'min' },
  { key: 'views', label: 'Views', presets: VIEW_BUCKETS, input: 'text', hint: 'e.g. 10k' },
  { key: 'published', label: 'Published', presets: DATE_PRESETS, input: 'date' },
  { key: 'saved', label: 'Saved', presets: DATE_PRESETS, input: 'date' },
];

const SPEEDS = [1, 1.25, 1.5, 1.75, 2];

const freshFilters = () => ({
  query: '',
  channel: '',
  tag: '',
  sort: 'added-desc',
  // each range filter is '' (off), a preset key, or 'custom' (then the typed values below are used)
  duration: '',
  views: '',
  published: '',
  saved: '',
  custom: Object.fromEntries(RANGE_KINDS.map((k) => [k.key, { min: '', max: '' }])),
});

const state = {
  open: false,
  tab: LISTS.WATCH_LATER,
  videos: [],
  settings: { ...store.DEFAULT_SETTINGS },
  filters: freshFilters(),
  autoOpenedForWL: false,
  handledUrl: '',
  currentVideoId: null, // the video page we are on (null on other pages)
  endPromptedFor: null, // the "Finished?" prompt shows once per video
  prompt: null, // { id, dismiss } of the Should Rewatch / Remove prompt that is on screen
  hint: null,
  showCoverage: false,
  stats: { events: [], snapshots: {}, loaded: false }, // the history, read when the Stats tab opens
  statsRange: '30d',
  statsImports: false, // include imported videos in the charts
  selected: new Set(), // ids ticked in the table (always a subset of what the filters show)
  shownIds: [], // ids currently shown, in table order
  lastIndex: null, // for shift-click range selection
  askResolve: null,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- shell: floating button, dialog, toasts (inside a shadow root so YouTube CSS can't touch it) ----------

const host = h('div', { id: 'mwl-host' });
const root = host.attachShadow({ mode: 'open' });

root.innerHTML = `
  <link rel="stylesheet" href="${chrome.runtime.getURL('content/overlay.css')}">
  <div class="root">
    <button class="fab" type="button" title="Open My Watch Later">▶ My Watch Later <span class="fab-count">0</span></button>
    <div class="toasts" aria-live="polite"></div>
    <div class="modal" hidden>
      <div class="backdrop"></div>
      <section class="dialog" role="dialog" aria-modal="true" aria-label="My Watch Later">
        <header class="head">
          <h2>My Watch Later</h2>
          <nav class="tabs">
            <button type="button" class="tab" data-tab="watchLater">Watch Later <span class="count"></span></button>
            <button type="button" class="tab" data-tab="rewatch">Should Rewatch <span class="count"></span></button>
            <button type="button" class="tab" data-tab="stats">📊 Stats</button>
          </nav>
          <button type="button" class="icon-btn close" aria-label="Close">✕</button>
        </header>
        <div class="toolbar">
          <input class="f-query" type="search" placeholder="Search title, channel or tag…">
          <select class="f-channel" aria-label="Channel"></select>
          <select class="f-tag" aria-label="Tag"></select>
          <select class="f-sort" aria-label="Sort"></select>
          <button type="button" class="btn clear">Clear</button>
          <span class="seg" role="group" aria-label="View">
            <button type="button" class="seg-btn" data-view="table">☰ Table</button>
            <button type="button" class="seg-btn" data-view="cards">▦ Cards</button>
          </span>
        </div>
        <div class="ranges"></div>
        <div class="subbar">
          <span class="result"></span>
          <span class="subbar-actions">
            <label class="speed">Speed <select class="f-speed" aria-label="Playback speed"></select></label>
            <button type="button" class="btn data-check">Data check</button>
            <button type="button" class="btn refresh" hidden></button>
            <button type="button" class="btn import" hidden>Import from YouTube Watch Later</button>
            <button type="button" class="btn danger wipe" hidden>Remove all from YouTube Watch Later…</button>
          </span>
        </div>
        <div class="bulk" hidden>
          <strong class="b-count">None selected</strong>
          <button type="button" class="btn small b-sel-all">Select all filtered</button>
          <button type="button" class="btn small b-sel-none">Uncheck all</button>
          <button type="button" class="btn small b-invert">Invert</button>
          <span class="b-sep"></span>
          <button type="button" class="btn small b-move"></button>
          <input class="b-tag" type="text" maxlength="30" placeholder="Add tag to selected, Enter">
          <select class="b-untag" aria-label="Remove a tag from the selected videos"></select>
          <button type="button" class="btn small danger b-remove">🗑 Remove selected</button>
        </div>
        <div class="coverage" hidden></div>
        <div class="stats" hidden></div>
        <div class="grid"></div>
      </section>
    </div>
    <div class="confirm" hidden>
      <div class="backdrop"></div>
      <section class="confirm-box" role="alertdialog" aria-modal="true" aria-label="Remove all from YouTube Watch Later">
        <h3>Remove everything from YouTube's Watch Later?</h3>
        <p>This empties your <strong>real</strong> YouTube Watch Later playlist, for your whole account and on every device. YouTube has no undo for it.</p>
        <label class="check"><input type="checkbox" class="c-copy" checked> Copy all videos into My Watch Later first (recommended)</label>
        <label class="c-label">Type <strong>REMOVE</strong> to confirm
          <input class="c-type" type="text" autocomplete="off" placeholder="REMOVE">
        </label>
        <p class="c-status" role="status"></p>
        <p class="c-note">Keep this tab open while it works. You can press Stop at any time.</p>
        <div class="c-actions">
          <button type="button" class="btn c-cancel">Cancel</button>
          <button type="button" class="btn danger-solid c-go" disabled>Remove all</button>
        </div>
      </section>
    </div>
    <div class="confirm ask" hidden>
      <div class="backdrop"></div>
      <section class="confirm-box" role="alertdialog" aria-modal="true">
        <h3 class="a-title"></h3>
        <p class="a-text"></p>
        <div class="c-actions">
          <button type="button" class="btn a-cancel">Cancel</button>
          <button type="button" class="btn danger-solid a-ok"></button>
        </div>
      </section>
    </div>
  </div>`;

const $ = (sel) => root.querySelector(sel);
const els = {
  fab: $('.fab'),
  fabCount: $('.fab-count'),
  toasts: $('.toasts'),
  modal: $('.modal'),
  backdrop: $('.backdrop'),
  close: $('.close'),
  tabs: [...root.querySelectorAll('.tab')],
  query: $('.f-query'),
  channel: $('.f-channel'),
  tag: $('.f-tag'),
  sort: $('.f-sort'),
  clear: $('.clear'),
  ranges: $('.ranges'),
  result: $('.result'),
  speed: $('.f-speed'),
  refresh: $('.refresh'),
  dataCheck: $('.data-check'),
  coverage: $('.coverage'),
  viewBtns: [...root.querySelectorAll('.seg-btn')],
  bulk: $('.bulk'),
  bCount: $('.b-count'),
  bSelAll: $('.b-sel-all'),
  bSelNone: $('.b-sel-none'),
  bInvert: $('.b-invert'),
  bMove: $('.b-move'),
  bTag: $('.b-tag'),
  bUntag: $('.b-untag'),
  bRemove: $('.b-remove'),
  ask: $('.ask'),
  aTitle: $('.a-title'),
  aText: $('.a-text'),
  aOk: $('.a-ok'),
  aCancel: $('.a-cancel'),
  importBtn: $('.import'),
  wipe: $('.wipe'),
  grid: $('.grid'),
  stats: $('.stats'),
  toolbar: $('.toolbar'),
  subbar: $('.subbar'),
  confirm: $('.confirm'),
  cCopy: $('.c-copy'),
  cType: $('.c-type'),
  cStatus: $('.c-status'),
  cCancel: $('.c-cancel'),
  cGo: $('.c-go'),
};

els.sort.replaceChildren(...SORT_OPTIONS.map((o) => h('option', { value: o.key, text: o.label })));
els.speed.replaceChildren(...SPEEDS.map((s) => h('option', { value: String(s), text: `${s}x` })));

// One group per range filter: [label] [preset ▾] and, when "Custom range…" is picked, [from] – [to].
const rangeEls = {};
for (const kind of RANGE_KINDS) {
  const select = h(
    'select',
    { 'aria-label': kind.label },
    h('option', { value: '', text: `Any ${kind.label.toLowerCase()}` }),
    ...kind.presets.map((p) => h('option', { value: p.key, text: p.label })),
    h('option', { value: 'custom', text: 'Custom range…' }),
  );
  const makeInput = (which) =>
    h('input', {
      class: 'range-in',
      type: kind.input,
      placeholder: kind.input === 'date' ? null : kind.hint || which,
      min: kind.input === 'number' ? '0' : null,
      step: kind.input === 'number' ? 'any' : null,
      'aria-label': `${kind.label} ${which}`,
    });
  const minIn = makeInput('from');
  const maxIn = makeInput('to');
  const custom = h(
    'span',
    { class: 'custom', hidden: true },
    minIn,
    h('span', { class: 'dash', text: '–' }),
    maxIn,
    kind.unit ? h('span', { class: 'unit', text: kind.unit }) : null,
  );
  select.addEventListener('change', () => {
    state.filters[kind.key] = select.value;
    render();
    if (select.value === 'custom') minIn.focus();
  });
  const onType = () => {
    state.filters.custom[kind.key] = { min: minIn.value, max: maxIn.value };
    render();
  };
  minIn.addEventListener('input', onType);
  maxIn.addEventListener('input', onType);
  rangeEls[kind.key] = { select, minIn, maxIn, custom };
  els.ranges.append(h('div', { class: 'range' }, h('span', { class: 'range-label', text: kind.label }), select, custom));
}

function syncDarkMode() {
  host.dataset.theme = document.documentElement.hasAttribute('dark') ? 'dark' : 'light';
}
syncDarkMode();
new MutationObserver(syncDarkMode).observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['dark'],
});

// While anything is fullscreen (the video player, usually) hide everything we added to the page.
// Whatever was on screen, such as the Should Rewatch prompt, is simply still there when you exit.
function syncFullscreen() {
  host.toggleAttribute('data-fullscreen', Boolean(document.fullscreenElement));
}
document.addEventListener('fullscreenchange', syncFullscreen);
document.addEventListener('webkitfullscreenchange', syncFullscreen);
syncFullscreen();

document.documentElement.append(host);

// After the extension is reloaded or updated, the copy of this script that is still sitting in an open
// tab can no longer reach the extension, and Chrome throws "Extension context invalidated".
// Detect that and switch the old copy off quietly. Refreshing the page starts a fresh one.
let routeTimer = null;
let dead = false;
function alive() {
  if (dead) return false;
  try {
    if (chrome.runtime && chrome.runtime.id) return true;
  } catch {
    // even reading chrome.runtime can throw once the context is gone
  }
  dead = true;
  clearInterval(routeTimer);
  host.remove();
  return false;
}

// ---------- toasts ----------

function showToast({
  text,
  sub,
  tagId,
  actions = [],
  timeout = 7000,
  variant = '',
  minimizable = false, // adds a button that shrinks the notice to a small pill
  minimized = false, // start as a pill
  onMinimize = () => {}, // called with true / false when the button is pressed
}) {
  const el = h(
    'div',
    { class: `toast ${variant}`.trim(), role: 'status' },
    h('div', { class: 'toast-text', text }),
    sub ? h('div', { class: 'toast-sub', text: sub }) : null,
  );

  if (minimizable) {
    let small = Boolean(minimized);
    const button = h('button', { type: 'button', class: 'toast-min' });
    const apply = () => {
      el.classList.toggle('min', small);
      button.textContent = small ? '⤢' : '–';
      button.title = small ? 'Expand' : 'Minimize';
      button.setAttribute('aria-label', button.title);
    };
    button.addEventListener('click', () => {
      small = !small;
      apply();
      onMinimize(small);
    });
    // the whole pill opens it again, not just the little button
    el.addEventListener('click', (e) => {
      if (small && !e.target.closest('button')) button.click();
    });
    apply();
    el.prepend(button);
  }

  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    el.remove();
  };
  const arm = () => {
    clearTimeout(timer);
    if (timeout) timer = setTimeout(dismiss, timeout);
  };

  if (tagId) {
    const input = h('input', {
      class: 'toast-tag',
      type: 'text',
      maxlength: '30',
      placeholder: 'Add a tag, then press Enter',
    });
    input.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const tag = normalizeTag(input.value);
      if (!tag) return;
      const record = await store.getVideo(tagId);
      if (record) await store.setTags(tagId, [...record.tags, tag]);
      input.value = '';
      input.placeholder = `Tagged “${tag}”. Add another?`;
    });
    input.addEventListener('focus', () => clearTimeout(timer));
    input.addEventListener('blur', arm);
    el.append(input);
  }

  if (actions.length) {
    el.append(
      h(
        'div',
        { class: 'toast-actions' },
        actions.map((a) =>
          h('button', {
            type: 'button',
            class: `btn small${a.primary ? ' primary' : ''}`,
            text: a.label,
            onclick: async () => {
              dismiss();
              await a.run();
            },
          }),
        ),
      ),
    );
  }

  els.toasts.append(el);
  arm();
  return dismiss;
}

// ---------- dialog: rendering ----------

function syncSelect(select, anyLabel, options, key) {
  if (!options.some((o) => o.value === state.filters[key])) state.filters[key] = '';
  select.replaceChildren(
    h('option', { value: '', text: anyLabel }),
    ...options.map((o) => h('option', { value: o.value, text: o.label })),
  );
  select.value = state.filters[key];
}

function renderChips(video) {
  const chips = video.tags.map((tag) =>
    h(
      'span',
      { class: 'chip' },
      h('button', {
        type: 'button',
        class: 'chip-label',
        text: tag,
        title: `Show only “${tag}”`,
        onclick: () => {
          state.filters.tag = tag;
          render();
        },
      }),
      h('button', {
        type: 'button',
        class: 'chip-x',
        text: '×',
        'aria-label': `Remove tag ${tag}`,
        onclick: () =>
          store.setTags(
            video.id,
            video.tags.filter((t) => t !== tag),
          ),
      }),
    ),
  );

  const addButton = h('button', {
    type: 'button',
    class: 'chip add',
    text: '+ tag',
    onclick: () => {
      const input = h('input', {
        class: 'tag-input',
        type: 'text',
        maxlength: '30',
        placeholder: 'tag',
      });
      let done = false;
      const finish = async (save) => {
        if (done) return;
        done = true;
        const tag = normalizeTag(input.value);
        if (save && tag) await store.setTags(video.id, [...video.tags, tag]);
        else render();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') finish(true);
        if (e.key === 'Escape') {
          e.stopPropagation();
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true));
      addButton.replaceWith(input);
      input.focus();
    },
  });

  return h('div', { class: 'tags' }, chips, addButton);
}

async function toggleList(video) {
  const toRewatch = video.list === LISTS.WATCH_LATER;
  const from = video.list;
  await store.moveVideo(video.id, toRewatch ? LISTS.REWATCH : LISTS.WATCH_LATER);
  showToast({
    text: toRewatch ? 'Moved to Should Rewatch' : 'Moved back to Watch Later',
    sub: video.title,
    actions: [{ label: 'Undo', run: () => store.moveVideo(video.id, from) }],
  });
}

async function removeWithUndo(video) {
  await store.removeVideo(video.id);
  showToast({
    text: 'Removed',
    sub: video.title,
    actions: [{ label: 'Undo', run: () => store.putVideo(video) }],
  });
}

function renderCard(video) {
  const url = watchUrl(video.id);
  const inWatchLater = video.list === LISTS.WATCH_LATER;
  return h(
    'article',
    { class: 'card' },
    h(
      'a',
      { class: 'thumb', href: url, title: video.title },
      h('img', { src: video.thumbnail, alt: '', loading: 'lazy' }),
      video.durationSec != null
        ? h('span', { class: 'dur', text: formatDuration(video.durationSec) })
        : null,
    ),
    h(
      'div',
      { class: 'body' },
      h('a', { class: 'title', href: url, text: video.title }),
      h('div', {
        class: 'meta',
        title: [
          video.publishedAt != null
            ? `Published ${video.publishedApprox ? 'about ' : ''}${formatDate(video.publishedAt)}`
            : '',
          `Saved ${formatDate(video.addedAt)}`,
        ]
          .filter(Boolean)
          .join(' · '),
        text: [
          video.channel,
          formatViews(video.views),
          video.publishedAt != null ? `${video.publishedApprox ? '~' : ''}${formatDate(video.publishedAt)}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      }),
      renderChips(video),
      h(
        'div',
        { class: 'actions' },
        h('button', {
          type: 'button',
          class: 'btn small',
          text: inWatchLater ? '↻ Should Rewatch' : '↩ Back to Watch Later',
          onclick: () => toggleList(video),
        }),
        h('button', {
          type: 'button',
          class: 'btn small ghost',
          text: 'Remove',
          onclick: () => removeWithUndo(video),
        }),
      ),
    ),
  );
}

function emptyState(inTabCount) {
  if (inTabCount > 0) {
    return h(
      'div',
      { class: 'empty' },
      h('p', { text: 'No videos match these filters.' }),
      h('button', { type: 'button', class: 'btn', text: 'Clear filters', onclick: clearFilters }),
    );
  }
  if (state.tab === LISTS.REWATCH) {
    return h(
      'div',
      { class: 'empty' },
      h('p', { text: 'Nothing to rewatch yet.' }),
      h('p', { class: 'sub', text: 'Use “↻ Should Rewatch” on a video in your Watch Later tab.' }),
    );
  }
  return h(
    'div',
    { class: 'empty' },
    h('p', { text: 'Your Watch Later list is empty.' }),
    h('p', {
      class: 'sub',
      text: 'Right-click any YouTube video and choose “Add to My Watch Later”.',
    }),
  );
}

// ---------- table view and bulk actions ----------

const isTableView = () => state.settings.view === 'table';
let rowEls = new Map(); // id -> { tr, cb }, so ticking a box never rebuilds the table
let headCb = null;

// Clicking a column title sorts by it; clicking again flips the direction.
const SORT_COLS = [
  { key: 'title', label: 'Title', asc: 'title-asc', desc: 'title-desc', first: 'asc' },
  { key: 'channel', label: 'Channel', asc: 'channel-asc', desc: 'channel-desc', first: 'asc' },
  { key: 'duration', label: 'Length', asc: 'duration-asc', desc: 'duration-desc', first: 'asc' },
  { key: 'views', label: 'Views', asc: 'views-asc', desc: 'views-desc', first: 'desc' },
  { key: 'published', label: 'Published', asc: 'published-asc', desc: 'published-desc', first: 'desc' },
  { key: 'saved', label: 'Saved', asc: 'added-asc', desc: 'added-desc', first: 'desc' },
];

const selectedVideos = () => state.videos.filter((v) => state.selected.has(v.id));

function sortHeader(col) {
  const current = state.filters.sort;
  const arrow = current === col.asc ? ' ▲' : current === col.desc ? ' ▼' : '';
  return h('th', {
    class: `sortable c-${col.key}`,
    text: col.label + arrow,
    title: 'Click to sort',
    onclick: () => {
      const first = col[col.first];
      const other = col.first === 'asc' ? col.desc : col.asc;
      state.filters.sort = current === first ? other : first;
      render();
    },
  });
}

function setChecked(id, on) {
  if (on) state.selected.add(id);
  else state.selected.delete(id);
}

// Tick or untick one row; with Shift, everything between the last click and this one.
function toggleRow(index, on, shift) {
  if (shift && state.lastIndex != null) {
    const from = Math.min(state.lastIndex, index);
    const to = Math.max(state.lastIndex, index);
    for (let i = from; i <= to; i++) setChecked(state.shownIds[i], on);
  } else {
    setChecked(state.shownIds[index], on);
  }
  state.lastIndex = index;
  syncSelection();
}

function renderRow(video, index) {
  const url = watchUrl(video.id);
  const cb = h('input', { type: 'checkbox', class: 'row-cb', 'aria-label': `Select ${video.title}` });
  cb.checked = state.selected.has(video.id);
  cb.addEventListener('click', (e) => toggleRow(index, cb.checked, e.shiftKey));

  const published =
    video.publishedAt != null ? `${video.publishedApprox ? '~' : ''}${formatDate(video.publishedAt)}` : '';
  const tr = h(
    'tr',
    { class: 'vrow' },
    h('td', { class: 'c-check' }, cb),
    h(
      'td',
      { class: 'c-thumb' },
      h('a', { href: url, title: video.title }, h('img', { src: video.thumbnail, alt: '', loading: 'lazy' })),
    ),
    h('td', { class: 'c-title' }, h('a', { class: 'title', href: url, text: video.title })),
    h('td', { class: 'c-channel', text: video.channel }),
    h('td', { class: 'num', text: formatDuration(video.durationSec) }),
    h('td', { class: 'num', text: formatViews(video.views) }),
    h('td', {
      class: 'num',
      text: published,
      title: video.publishedApprox ? 'Estimated from “… ago”. Use “Fill missing details” for the exact date.' : '',
    }),
    h('td', { class: 'num', text: formatDate(video.addedAt) }),
    h('td', { class: 'c-tags' }, renderChips(video)),
    h(
      'td',
      { class: 'c-rowactions' },
      h('button', {
        type: 'button',
        class: 'btn small',
        text: video.list === LISTS.WATCH_LATER ? '↻' : '↩',
        title: video.list === LISTS.WATCH_LATER ? 'Move to Should Rewatch' : 'Move back to Watch Later',
        onclick: () => toggleList(video),
      }),
      h('button', {
        type: 'button',
        class: 'btn small ghost',
        text: '✕',
        title: 'Remove',
        onclick: () => removeWithUndo(video),
      }),
    ),
  );
  // clicking anywhere else on the row ticks it too
  tr.addEventListener('click', (e) => {
    if (e.target.closest('a, button, input, select')) return;
    toggleRow(index, !state.selected.has(video.id), e.shiftKey);
  });
  rowEls.set(video.id, { tr, cb });
  return tr;
}

function renderTable(shown) {
  rowEls = new Map();
  headCb = h('input', { type: 'checkbox', class: 'row-cb', 'aria-label': 'Select all filtered videos' });
  headCb.addEventListener('click', () => selectShown(headCb.checked));
  return h(
    'table',
    { class: 'vt' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        h('th', { class: 'c-check' }, headCb),
        h('th', { class: 'c-thumb' }),
        ...SORT_COLS.map(sortHeader),
        h('th', { class: 'c-tags', text: 'Tags' }),
        h('th', { class: 'c-rowactions' }),
      ),
    ),
    h('tbody', {}, shown.map(renderRow)),
  );
}

// Updates every checkbox, the highlight and the bulk bar in place (no rebuild).
function syncSelection() {
  const n = state.selected.size;
  const total = state.shownIds.length;
  for (const [id, { tr, cb }] of rowEls) {
    const on = state.selected.has(id);
    cb.checked = on;
    tr.classList.toggle('sel', on);
  }
  if (headCb) {
    headCb.checked = total > 0 && n === total;
    headCb.indeterminate = n > 0 && n < total;
  }
  els.bCount.textContent = n ? `${n} selected` : 'None selected';
  els.bSelAll.textContent = `Select all filtered (${total})`;
  els.bSelAll.disabled = total === 0 || n === total;
  els.bSelNone.disabled = n === 0;
  els.bInvert.disabled = total === 0;
  for (const el of [els.bMove, els.bRemove, els.bTag, els.bUntag]) el.disabled = n === 0;
  els.bMove.textContent =
    state.tab === LISTS.WATCH_LATER ? '↻ Move to Should Rewatch' : '↩ Move to Watch Later';
  els.bUntag.replaceChildren(
    h('option', { value: '', text: 'Remove tag…' }),
    ...uniqueTags(selectedVideos()).map((t) => h('option', { value: t.name, text: `#${t.name} (${t.count})` })),
  );
}

function selectShown(on) {
  for (const id of state.shownIds) setChecked(id, on);
  syncSelection();
}

function invertShown() {
  for (const id of state.shownIds) setChecked(id, !state.selected.has(id));
  syncSelection();
}

// Yes / no question in our own dialog. Resolves true only when the red button is pressed.
function askConfirm({ title, text, okLabel }) {
  return new Promise((resolve) => {
    els.aTitle.textContent = title;
    els.aText.textContent = text;
    els.aOk.textContent = okLabel;
    els.ask.hidden = false;
    els.aCancel.focus(); // the safe choice is the default
    const done = (answer) => {
      els.ask.hidden = true;
      state.askResolve = null;
      resolve(answer);
    };
    state.askResolve = done;
    els.aOk.onclick = () => done(true);
    els.aCancel.onclick = () => done(false);
  });
}
els.ask.querySelector('.backdrop').addEventListener('click', () => state.askResolve && state.askResolve(false));

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

async function bulkRemove() {
  const picked = selectedVideos();
  if (!picked.length) return;
  const ok = await askConfirm({
    title: `Remove ${plural(picked.length, 'video')}?`,
    text: 'They are removed from your list in this extension only (not from YouTube). You can undo right after.',
    okLabel: `Remove ${picked.length}`,
  });
  if (!ok) return;
  await store.removeMany(picked.map((v) => v.id));
  showToast({
    text: `Removed ${plural(picked.length, 'video')}`,
    timeout: 20000,
    actions: [{ label: 'Undo', run: () => store.putMany(picked) }],
  });
}

async function bulkMove() {
  const picked = selectedVideos();
  if (!picked.length) return;
  const from = state.tab;
  const to = from === LISTS.WATCH_LATER ? LISTS.REWATCH : LISTS.WATCH_LATER;
  const ids = picked.map((v) => v.id);
  await store.moveMany(ids, to);
  showToast({
    text: `Moved ${plural(picked.length, 'video')} to ${to === LISTS.REWATCH ? 'Should Rewatch' : 'Watch Later'}`,
    timeout: 12000,
    actions: [{ label: 'Undo', run: () => store.moveMany(ids, from) }],
  });
}

async function bulkAddTag() {
  const tag = normalizeTag(els.bTag.value);
  const ids = [...state.selected];
  if (!tag || !ids.length) return;
  const changed = await store.addTagMany(ids, tag);
  els.bTag.value = '';
  showToast({
    text: `Tagged ${plural(ids.length, 'video')} “${tag}”`,
    sub: changed < ids.length ? `${ids.length - changed} already had it.` : undefined,
  });
}

async function bulkRemoveTag() {
  const tag = els.bUntag.value;
  const ids = [...state.selected];
  if (!tag || !ids.length) return;
  const changed = await store.removeTagMany(ids, tag);
  showToast({ text: `Removed “${tag}” from ${plural(changed, 'video')}` });
}

els.bSelAll.addEventListener('click', () => selectShown(true));
els.bSelNone.addEventListener('click', () => selectShown(false));
els.bInvert.addEventListener('click', invertShown);
els.bMove.addEventListener('click', bulkMove);
els.bRemove.addEventListener('click', bulkRemove);
els.bTag.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    bulkAddTag();
  }
});
els.bUntag.addEventListener('change', bulkRemoveTag);
for (const btn of els.viewBtns) {
  btn.addEventListener('click', async () => {
    state.settings = { ...state.settings, view: btn.dataset.view };
    render();
    await store.setSettings({ view: btn.dataset.view });
  });
}

function render() {
  const inTab = state.videos.filter((v) => v.list === state.tab);
  const counts = {
    [LISTS.WATCH_LATER]: state.videos.filter((v) => v.list === LISTS.WATCH_LATER).length,
    [LISTS.REWATCH]: state.videos.filter((v) => v.list === LISTS.REWATCH).length,
  };

  els.fabCount.textContent = String(counts[LISTS.WATCH_LATER]);
  for (const tab of els.tabs) {
    tab.classList.toggle('active', tab.dataset.tab === state.tab);
    const count = tab.querySelector('.count'); // the Stats tab has none
    if (count) count.textContent = String(counts[tab.dataset.tab]);
  }
  if (!state.open) return;

  // The Stats tab replaces the filters and the list with its own page.
  const statsMode = state.tab === STATS_TAB;
  els.stats.hidden = !statsMode;
  for (const el of [els.toolbar, els.ranges, els.subbar]) el.hidden = statsMode;
  if (statsMode) {
    els.bulk.hidden = true;
    els.coverage.hidden = true;
    els.grid.hidden = true;
    renderStatsTab();
    return;
  }
  els.grid.hidden = false;

  syncSelect(
    els.channel,
    'Any channel',
    uniqueChannels(inTab).map((c) => ({ value: c.name, label: `${c.name} (${c.count})` })),
    'channel',
  );
  syncSelect(
    els.tag,
    'Any tag',
    uniqueTags(inTab).map((t) => ({ value: t.name, label: `#${t.name} (${t.count})` })),
    'tag',
  );
  if (els.query.value !== state.filters.query) els.query.value = state.filters.query;
  els.sort.value = state.filters.sort;
  for (const kind of RANGE_KINDS) {
    const r = rangeEls[kind.key];
    const typed = state.filters.custom[kind.key];
    r.select.value = state.filters[kind.key];
    r.custom.hidden = state.filters[kind.key] !== 'custom';
    if (r.minIn.value !== typed.min) r.minIn.value = typed.min;
    if (r.maxIn.value !== typed.max) r.maxIn.value = typed.max;
  }

  const eff = effectiveFilters();
  const shown = sortVideos(applyFilters(inTab, eff), state.filters.sort);
  renderSummary(shown, inTab.length, hiddenByUnknown(inTab, eff));
  renderRefreshButton();
  renderCoverage();

  // Ticked rows always stay a subset of what is shown, so a bulk action can never touch a video
  // you can't see (changing a filter or switching tab unticks the rows that disappear).
  state.shownIds = shown.map((v) => v.id);
  const visible = new Set(state.shownIds);
  for (const id of [...state.selected]) if (!visible.has(id)) state.selected.delete(id);
  state.lastIndex = null;

  const table = isTableView();
  els.bulk.hidden = !table;
  els.grid.classList.toggle('table-mode', table);
  for (const btn of els.viewBtns) btn.classList.toggle('active', (btn.dataset.view === 'table') === table);
  if (!shown.length) {
    rowEls = new Map();
    headCb = null;
    els.grid.replaceChildren(emptyState(inTab.length));
  } else {
    els.grid.replaceChildren(...(table ? [renderTable(shown)] : shown.map(renderCard)));
  }
  syncSelection();
}

// What applyFilters needs: the tab, plus each range as a preset key or the typed custom range.
function effectiveFilters() {
  const f = state.filters;
  const out = { list: state.tab, query: f.query, channel: f.channel, tag: f.tag };
  for (const kind of RANGE_KINDS) {
    out[kind.key] =
      f[kind.key] === 'custom'
        ? customRange(kind.key, f.custom[kind.key].min, f.custom[kind.key].max)
        : f[kind.key];
  }
  return out;
}

// A video whose value is unknown never matches a filter on that value. Say so, so a filter that
// "shows nothing" is explained instead of looking broken.
const FIELD_OF = { duration: 'durationSec', views: 'views', published: 'publishedAt', saved: 'addedAt' };

function hiddenByUnknown(inTab, eff) {
  const notes = [];
  for (const kind of RANGE_KINDS) {
    if (!eff[kind.key]) continue; // that filter is off
    const n = inTab.filter((v) => v[FIELD_OF[kind.key]] == null).length;
    if (n) notes.push({ label: kind.label.toLowerCase(), n });
  }
  return notes;
}

// The "Data check" panel: how many videos have each piece of information.
function renderCoverage() {
  els.coverage.hidden = !state.showCoverage;
  els.dataCheck.classList.toggle('active', Boolean(state.showCoverage));
  if (!state.showCoverage) return;
  const c = dataCoverage(state.videos);
  const row = (name, text, bad) =>
    h('div', { class: `cov-row${bad ? ' bad' : ''}` }, h('span', { class: 'cov-name', text: name }), h('span', { text }));
  const of = (field) => `${field.have} of ${c.total}` + (field.missing ? ` (${field.missing} missing)` : '');
  els.coverage.replaceChildren(
    h('div', { class: 'cov-title', text: `What we know about your ${c.total} saved videos` }),
    row('Length', of(c.length), c.length.missing > 0),
    row('Views', of(c.views), c.views.missing > 0),
    row('Channel', of(c.channel), c.channel.missing > 0),
    row(
      'Published date',
      `${c.published.exact} exact · ${c.published.approx} estimated · ${c.published.missing} missing`,
      c.published.missing + c.published.approx > 0,
    ),
    h('div', {
      class: 'cov-hint',
      text: 'Title, thumbnail, saved date and tags always exist. “Estimated” dates come from YouTube’s “2 years ago” text. Click “Fill missing details” to replace estimates and gaps with exact values.',
    }),
  );
}

// "12 of 40 videos  ⏱ 8h 25m ≈ 8.4 hours to watch"
function renderSummary(shown, inTabCount, hidden = []) {
  const speed = state.settings.playbackSpeed || 1;
  const total = totalDuration(shown, speed);
  const verb = state.tab === LISTS.REWATCH ? 'rewatch' : 'watch';
  const count =
    shown.length === inTabCount
      ? `${inTabCount} video${inTabCount === 1 ? '' : 's'}`
      : `${shown.length} of ${inTabCount} videos`;

  const parts = [h('span', { class: 'count-text', text: count })];
  if (total.known) {
    // "7d 8h 25m (176.4 hours · 7.3 days)": the breakdown first, then the same total as plain numbers
    const asNumbers = [];
    if (total.seconds >= 3600) asNumbers.push(formatHours(total.seconds));
    if (total.seconds >= 86400) asNumbers.push(formatDays(total.seconds));
    const numbers = asNumbers.length ? ` (${asNumbers.join(' · ')})` : '';
    parts.push(
      h('span', {
        class: 'total',
        title: `Adds up the length of the ${total.known} videos shown, at ${speed}x speed. A day is 24 hours and a month is 30 days.`,
        text: `⏱ ${formatTotalTime(total.seconds)}${numbers} to ${verb}${speed === 1 ? '' : ` at ${speed}x`}`,
      }),
    );
  }
  if (total.unknown) {
    parts.push(
      h('span', {
        class: 'warn',
        title: 'These videos have no length yet, so they are not in the total. Use “Fill missing details”.',
        text: `+ ${total.unknown} without length`,
      }),
    );
  }
  for (const { label, n } of hidden) {
    parts.push(
      h('span', {
        class: 'warn',
        title: 'Videos with an unknown value can’t match this filter. Open “Data check”, then “Fill missing details”.',
        text: `${n} hidden: ${label} unknown`,
      }),
    );
  }
  els.result.replaceChildren(...parts);
  els.speed.value = String(speed);
}

function clearFilters() {
  state.filters = freshFilters();
  render();
}

// ---------- the Stats tab ----------

const STATS_TAB = 'stats';

function renderStatsTab() {
  if (!state.stats.loaded) {
    els.stats.replaceChildren(h('p', { class: 'st-none', text: 'Loading your history…' }));
    return;
  }
  els.stats.replaceChildren(
    renderStats({
      videos: state.videos,
      events: state.stats.events,
      snapshots: state.stats.snapshots,
      range: state.statsRange,
      includeImports: state.statsImports,
      now: Date.now(),
      onRange: (key) => {
        state.statsRange = key;
        render();
      },
      onImports: (on) => {
        state.statsImports = on;
        render();
      },
      onReview: reviewOldVideos,
    }),
  );
}

async function loadStats() {
  try {
    await store.ensureBackfill();
    const [events, snapshots] = await Promise.all([store.listEvents(), store.getSnapshots()]);
    state.stats = { events, snapshots, loaded: true };
  } catch {
    alive(); // most likely the extension was reloaded: switch this old copy off
    state.stats = { events: [], snapshots: {}, loaded: true };
  }
  if (state.open && state.tab === STATS_TAB) render();
}

let statsTimer = null;
function scheduleStatsReload() {
  if (statsTimer || !(state.open && state.tab === STATS_TAB)) return;
  statsTimer = setTimeout(() => {
    statsTimer = null;
    loadStats();
  }, 400);
}

// "Review in list": the Watch Later tab, oldest first, filtered to videos saved before the cutoff.
function reviewOldVideos(cutoff) {
  state.tab = LISTS.WATCH_LATER;
  state.filters = freshFilters();
  state.filters.saved = 'custom';
  state.filters.custom.saved = { min: '', max: dayKey(cutoff) };
  state.filters.sort = 'added-asc';
  render();
}

// Coalesces bursts of changes (for example while details are being filled in) into one redraw.
let renderTimer = null;
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => {
    renderTimer = null;
    // don't wipe a tag you are in the middle of typing
    if (root.activeElement && root.activeElement.classList.contains('tag-input')) return scheduleRender();
    render();
  }, refresh.running ? 1000 : 150); // slower while details load, so a big table doesn't flicker
}

// ---------- fill in missing details (length, views, published date) ----------

// An estimated published date still counts as "missing" here: the video page has the exact one.
const needsDetails = (v) =>
  !v.detailsAt &&
  (v.durationSec == null || v.views == null || v.publishedAt == null || v.publishedApprox);

const refresh = { running: false, stop: false, done: 0, total: 0 };

function renderRefreshButton() {
  const missing = state.videos.filter(needsDetails).length;
  els.refresh.hidden = !refresh.running && missing === 0;
  els.refresh.textContent = refresh.running
    ? `Filling details… ${refresh.done}/${refresh.total} (click to stop)`
    : `Fill missing details (${missing})`;
  els.refresh.title =
    'Reads length, views and published date for videos that are missing them. Needed for the published filter and the time total.';
}

async function fillMissingDetails() {
  if (refresh.running) {
    refresh.stop = true;
    return;
  }
  const queue = state.videos.filter(needsDetails).map((v) => v.id);
  if (!queue.length) return;
  Object.assign(refresh, { running: true, stop: false, done: 0, total: queue.length });
  let failed = 0;
  let blocked = false;
  renderRefreshButton();

  const worker = async () => {
    while (queue.length && !refresh.stop) {
      const id = queue.shift();
      try {
        await store.patchVideo(id, await fetchVideoMeta(id));
      } catch (err) {
        failed++;
        if (/429/.test(String(err.message))) {
          blocked = true;
          refresh.stop = true;
        }
      }
      refresh.done++;
      renderRefreshButton();
      await sleep(250); // be gentle with YouTube
    }
  };
  await Promise.all([worker(), worker()]);

  const stoppedEarly = refresh.stop;
  refresh.running = false;
  render();
  showToast({
    text: blocked
      ? 'YouTube asked us to slow down'
      : stoppedEarly
        ? 'Stopped'
        : 'Details are up to date',
    sub: blocked
      ? 'Wait a few minutes, then click “Fill missing details” again.'
      : `${refresh.done - failed} of ${refresh.total} videos filled in${failed ? `, ${failed} failed` : ''}.`,
  });
}
els.refresh.addEventListener('click', fillMissingDetails);
els.dataCheck.addEventListener('click', () => {
  state.showCoverage = !state.showCoverage;
  render();
});

els.speed.addEventListener('change', async () => {
  const playbackSpeed = Number(els.speed.value) || 1;
  state.settings = { ...state.settings, playbackSpeed };
  render();
  await store.setSettings({ playbackSpeed });
});

// ---------- dialog: open / close ----------

const isWatchLaterPage = () =>
  location.pathname === '/playlist' && new URLSearchParams(location.search).get('list') === 'WL';

function openDialog(tab) {
  if (tab) state.tab = tab;
  state.open = true;
  els.modal.hidden = false;
  els.fab.hidden = true;
  els.importBtn.hidden = !isWatchLaterPage();
  els.wipe.hidden = !isWatchLaterPage();
  render();
}

function closeDialog() {
  state.open = false;
  state.autoOpenedForWL = false;
  els.modal.hidden = true;
  els.fab.hidden = false;
}

els.fab.addEventListener('click', () => openDialog());
els.close.addEventListener('click', closeDialog);
els.backdrop.addEventListener('click', closeDialog);
for (const tab of els.tabs) {
  tab.addEventListener('click', () => {
    state.tab = tab.dataset.tab;
    render();
    if (state.tab === STATS_TAB) loadStats(); // always read the latest history when the tab opens
  });
}
els.query.addEventListener('input', () => {
  state.filters.query = els.query.value;
  render();
});
for (const key of ['channel', 'tag', 'sort']) {
  els[key].addEventListener('change', () => {
    state.filters[key] = els[key].value;
    render();
  });
}
els.clear.addEventListener('click', clearFilters);

// Esc closes the dialog (but not while you are typing a new tag on a card: there it cancels the tag).
window.addEventListener(
  'keydown',
  (e) => {
    // isTrusted: ignore the pretend Esc we send to close YouTube's own menus
    if (!e.isTrusted || e.key !== 'Escape') return;
    if (state.askResolve) {
      state.askResolve(false);
      return;
    }
    if (!els.confirm.hidden) {
      closeWipeConfirm();
      return;
    }
    if (!state.open) return;
    const active = root.activeElement;
    if (active && active.classList.contains('tag-input')) return;
    closeDialog();
  },
  true,
);
// Keep YouTube's keyboard shortcuts (space, f, k …) from firing while you type in our dialog.
for (const type of ['keydown', 'keyup', 'keypress']) {
  root.addEventListener(type, (e) => e.stopPropagation());
}

// ---------- import from YouTube's own Watch Later page ----------

function scrapeWatchLaterPage() {
  const now = Date.now();
  const found = [];
  document.querySelectorAll('ytd-playlist-video-renderer').forEach((el, index) => {
    const link = el.querySelector('a#video-title') || el.querySelector('a[href*="watch?v="]');
    const id = parseVideoId(link && link.href);
    if (!id) return; // deleted / private videos have no link
    const text = (sel) => (el.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
    const duration = (text('ytd-thumbnail-overlay-time-status-renderer').match(
      /\d+:\d{2}(?::\d{2})?/,
    ) || [])[0];
    const info = text('#video-info'); // "1.2M views • 2 years ago"
    const views = info.match(/([\d.,]+\s*[KMB]?)\s*views?/i);
    const published = parseRelativeAge(info, now);
    found.push({
      id,
      title: (link.getAttribute('title') || link.textContent || '').trim(),
      channel: text('ytd-channel-name'),
      durationSec: parseDuration(duration),
      views: views ? parseViews(views[1]) : null,
      publishedAt: published, // an estimate: "Fill missing details" replaces it with the exact date
      publishedApprox: published != null,
      addedAt: now - index * 1000, // keeps YouTube's order when sorting by "Recently saved"
    });
  });
  return found;
}

async function importFromYouTube() {
  const label = els.importBtn.textContent;
  els.importBtn.disabled = true;
  try {
    await loadAll((found) => {
      els.importBtn.textContent = `Reading your list… ${found} found`;
    });

    const items = scrapeWatchLaterPage();
    if (!items.length) {
      showToast({
        text: 'No videos found on this page',
        sub: 'Open youtube.com/playlist?list=WL while signed in, then try again.',
      });
      return;
    }
    const { added, already } = await store.importVideos(items);
    showToast({
      text: `Imported ${added} new video${added === 1 ? '' : 's'}`,
      sub:
        (already ? `${already} were already in your list. ` : '') +
        'Click “Fill missing details” to load published dates.',
    });
  } finally {
    els.importBtn.disabled = false;
    els.importBtn.textContent = label;
  }
}
els.importBtn.addEventListener('click', importFromYouTube);

// ---------- remove everything from YouTube's own Watch Later ----------

const wipe = { running: false, stop: false };

function openWipeConfirm() {
  els.cCopy.checked = true;
  els.cCopy.disabled = false;
  els.cType.value = '';
  els.cType.disabled = false;
  els.cGo.disabled = true;
  els.cGo.hidden = false;
  els.cCancel.textContent = 'Cancel';
  els.cStatus.textContent = '';
  els.confirm.hidden = false;
  els.cType.focus();
}

function closeWipeConfirm() {
  if (wipe.running) return; // use Stop while it is working
  els.confirm.hidden = true;
}

async function runWipe() {
  const say = (text) => {
    els.cStatus.textContent = text;
  };
  wipe.running = true;
  wipe.stop = false;
  for (const el of [els.cType, els.cCopy, els.cGo]) el.disabled = true;
  els.cCancel.textContent = 'Stop';
  let copied = false;

  try {
    say('Loading your whole list…');
    await loadAll((found) => say(`Loading your whole list… ${found} found`), () => wipe.stop);
    if (wipe.stop) return say('Stopped. Nothing was removed.');

    const items = scrapeWatchLaterPage();
    if (!items.length) return say('No videos found on this page, so there is nothing to remove.');

    if (els.cCopy.checked) {
      say(`Copying ${items.length} videos into My Watch Later…`);
      await store.importVideos(items);
      const saved = await store.getVideos();
      // only go on if every single video is safely in our list
      if (!items.every((item) => saved[item.id])) {
        return say("Couldn't save a copy of every video, so nothing was removed.");
      }
      copied = true;
    }

    say(`Removing from YouTube… 0 of ${items.length}`);
    const result = await removeAll({
      onProgress: ({ removed }) => say(`Removing from YouTube… ${removed} of ${items.length}`),
      shouldStop: () => wipe.stop,
    });
    const backup = copied ? ' A copy is in My Watch Later.' : '';
    if (result.stopped === 'done') {
      say(`Done. Removed ${result.removed} videos from YouTube's Watch Later.${backup}`);
    } else if (result.stopped === 'user') {
      say(`Stopped after ${result.removed}. The rest are still in YouTube's Watch Later.${backup}`);
    } else {
      say(
        `Stopped after ${result.removed}: ${result.message}. YouTube may have changed its page. ` +
          `The rest are still there.${backup}`,
      );
    }
  } catch (err) {
    say(`Something went wrong: ${err.message || err}`);
  } finally {
    wipe.running = false;
    els.cCancel.textContent = 'Close';
    els.cGo.hidden = true;
  }
}

els.wipe.addEventListener('click', openWipeConfirm);
els.cType.addEventListener('input', () => {
  els.cGo.disabled = els.cType.value.trim().toUpperCase() !== 'REMOVE';
});
els.cGo.addEventListener('click', runWipe);
els.cCancel.addEventListener('click', () => {
  if (wipe.running) {
    wipe.stop = true;
    els.cStatus.textContent = 'Stopping…';
  } else {
    closeWipeConfirm();
  }
});

// ---------- right-click: remember which video was clicked ----------

const CARD_SELECTOR = [
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-compact-video-renderer',
  'ytd-grid-video-renderer',
  'ytd-playlist-video-renderer',
  'ytd-reel-item-renderer',
  'yt-lockup-view-model',
].join(',');

document.addEventListener(
  'contextmenu',
  (e) => {
    if (!alive()) return;
    try {
      const path = e.composedPath();
      const anchor = path.find((n) => n instanceof HTMLAnchorElement && n.href);
      const id = parseVideoId(anchor && anchor.href) || parseVideoId(location.href);
      const card = anchor && anchor.closest(CARD_SELECTOR);
      const text = (sel) => (card?.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim();
      let title =
        text('#video-title') ||
        text('h3') ||
        (anchor && (anchor.getAttribute('title') || anchor.getAttribute('aria-label'))) ||
        '';
      if (!card && id === parseVideoId(location.href)) {
        title = document.title.replace(/^\(\d+\)\s*/, '').replace(/ - YouTube$/, '');
      }
      state.hint = { id, title: title.trim(), channel: text('ytd-channel-name') };
    } catch {
      state.hint = null;
    }
  },
  true,
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'get-hint') {
    sendResponse(state.hint);
  } else if (message.type === 'toast') {
    showToast(message);
  } else if (message.type === 'open-dialog') {
    openDialog();
  }
});

// ---------- "Finished?" prompt at the end of a saved video ----------

function isMainPlayerVideo(video) {
  if (video.closest('ytd-video-preview')) return false; // hover previews
  if (document.querySelector('.html5-video-player.ad-showing')) return false;
  return Boolean(video.closest('#movie_player, .html5-video-player'));
}

function dismissPrompt() {
  if (state.prompt) {
    state.prompt.dismiss();
    state.prompt = null;
  }
}

// The red Should Rewatch / Remove / Keep prompt for a video saved in Watch Later.
//   'open' = shown as soon as you open the video, and it stays until you choose
//   'end'  = shown again when the video finishes (even if you pressed Keep earlier)
async function showSavedPrompt(id, kind) {
  if (!state.settings.promptOnFinish) return;
  let record;
  try {
    record = await store.getVideo(id);
  } catch {
    alive(); // most likely the extension was reloaded: switch this old copy off
    return;
  }
  if (!record || record.list !== LISTS.WATCH_LATER) return;
  if (parseVideoId(location.href) !== id) return; // you moved on while we were looking it up

  dismissPrompt();
  const finished = kind === 'end';
  // Removing a video you just finished means "done"; removing one you haven't watched is just discarding it.
  const wasWatched = finished || state.endPromptedFor === id;
  const choose = (choice) => store.logEvents([makeEvent(EVENT.PROMPT, id, { choice, kind })]).catch(() => {});
  const dismiss = showToast({
    text: finished ? '🎉 Finished this one? 🎬' : '📌 Saved in My Watch Later',
    sub: `📺 ${record.title}`,
    timeout: 0, // stays until you choose
    variant: 'finish',
    minimizable: true,
    // the "finished" moment always opens fully; the opening prompt follows your last choice
    minimized: !finished && Boolean(state.settings.promptMinimized),
    onMinimize: (minimized) => {
      state.settings = { ...state.settings, promptMinimized: minimized };
      store.setSettings({ promptMinimized: minimized }).catch(() => {});
    },
    actions: [
      {
        label: '🔁 Should Rewatch',
        primary: true,
        run: async () => {
          choose('rewatch');
          await store.moveVideo(id, LISTS.REWATCH);
        },
      },
      {
        label: '🗑️ Remove',
        run: async () => {
          choose('remove');
          await store.removeVideo(id, wasWatched ? 'done' : 'manual');
        },
      },
      { label: '👍 Keep', run: async () => choose('keep') },
    ],
  });
  state.prompt = { id, dismiss };
}

// A saved video reached its end: write it to the history (whatever the prompt setting is), then show the prompt.
async function logFinished(id) {
  try {
    const record = await store.getVideo(id);
    if (record) await store.logEvents([eventFor(EVENT.FINISHED, record)]);
  } catch {
    alive(); // most likely the extension was reloaded: switch this old copy off
  }
}

function maybeFinishPrompt(video) {
  const id = parseVideoId(location.href);
  if (!id || id === state.endPromptedFor || !isMainPlayerVideo(video)) return;
  state.endPromptedFor = id;
  logFinished(id);
  showSavedPrompt(id, 'end');
}

document.addEventListener(
  'timeupdate',
  (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || !alive()) return;
    if (v.duration > 20 && v.currentTime > 0 && v.duration - v.currentTime <= 5) maybeFinishPrompt(v);
  },
  true,
);
document.addEventListener(
  'ended',
  (e) => {
    if (e.target instanceof HTMLVideoElement && alive()) maybeFinishPrompt(e.target);
  },
  true,
);

// ---------- routing: YouTube is a single-page app, so watch for address changes ----------

function handleRoute(initial = false) {
  if (!initial && state.handledUrl === location.href) return;
  state.handledUrl = location.href;

  // A different video (or a page that isn't a video): drop the old prompt and, for a saved video, show a new one.
  const videoId = parseVideoId(location.href);
  if (videoId !== state.currentVideoId) {
    state.currentVideoId = videoId;
    state.endPromptedFor = null;
    dismissPrompt();
    if (videoId) showSavedPrompt(videoId, 'open');
  }

  const params = new URLSearchParams(location.search);
  if (params.get('mwl') === '1') {
    params.delete('mwl');
    const query = params.toString();
    history.replaceState(history.state, '', location.pathname + (query ? `?${query}` : '') + location.hash);
    state.handledUrl = location.href;
    openDialog();
    return;
  }
  if (isWatchLaterPage()) {
    if (state.settings.overrideWatchLater) {
      openDialog(LISTS.WATCH_LATER);
      state.autoOpenedForWL = true;
    }
    return;
  }
  if (state.open && state.autoOpenedForWL) closeDialog();
  if (initial && location.pathname === '/' && state.settings.autoOpenHome) openDialog();
}

document.addEventListener('yt-navigate-finish', () => alive() && handleRoute());
let lastHref = location.href;
routeTimer = setInterval(() => {
  if (!alive()) return;
  if (location.href !== lastHref) {
    lastHref = location.href;
    handleRoute();
  }
}, 800);

// ---------- live updates and start ----------

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  // the history changed (a video was saved, finished, removed …): refresh the Stats tab if it is open
  if (Object.keys(changes).some((k) => k.startsWith('events:') || k === 'snapshots')) scheduleStatsReload();
  if (changes.videos) {
    state.videos = Object.values(changes.videos.newValue || {});
    scheduleRender();
    // the video was removed or moved (for example from the dialog or another tab): the prompt no longer applies
    const p = state.prompt;
    if (p && !state.videos.some((v) => v.id === p.id && v.list === LISTS.WATCH_LATER)) dismissPrompt();
  }
  if (changes.settings) {
    state.settings = { ...store.DEFAULT_SETTINGS, ...(changes.settings.newValue || {}) };
    scheduleRender();
  }
});

(async () => {
  [state.videos, state.settings] = await Promise.all([store.listVideos(), store.getSettings()]);
  render();
  handleRoute(true);
})();
