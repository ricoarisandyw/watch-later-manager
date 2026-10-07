// The icon set: small duotone SVGs on a 24 x 24 grid: a solid outline over a soft fill of the same colour.
// Both take the text colour (currentColor), so they follow the light and dark themes. Used by the dialog, the alarm, the Stats tab, the popup and the settings page.
//   icon('trash')                 -> an <svg class="ico"> element
//   <span data-icon="trash">      -> in a fixed HTML template, filled in by hydrateIcons(root)
// An icon followed by a label gets a gap. An icon on its own (no label) is marked "solo": icon('x', 'solo'), or
// data-solo on the placeholder, so it has no gap and stays centred.
// Emoji and symbol characters are not used in the pages: they look different on every system.

const SVG_NS = 'http://www.w3.org/2000/svg';

// paths: "d" strings, or { d, tone: true } for one that is not closed but still wants the soft fill.
// shapes: [tag, attributes] for circles, rectangles and so on (always filled softly).
// A path that ends in "z" is a closed shape, so it gets the soft fill by itself; open lines stay outline only.
const TONE_OPACITY = 0.22;
const ICONS = {
  play: { paths: ['M7 4.5v15l12.5-7.5z'] },
  stop: { shapes: [['rect', { x: 6, y: 6, width: 12, height: 12, rx: 1.5 }]] },
  x: { paths: ['M18 6 6 18', 'M6 6l12 12'] },
  trash: {
    paths: [
      'M3 6h18',
      { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6', tone: true },
      'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
      'M10 11v6',
      'M14 11v6',
    ],
  },
  repeat: { paths: ['m17 2 4 4-4 4', 'M3 11v-1a4 4 0 0 1 4-4h14', 'm7 22-4-4 4-4', 'M21 13v1a4 4 0 0 1-4 4H3'] },
  undo: { paths: ['M3 7v6h6', 'M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13'] },
  list: { paths: ['M8 6h13', 'M8 12h13', 'M8 18h13', 'M3 6h.01', 'M3 12h.01', 'M3 18h.01'] },
  grid: {
    shapes: [
      ['rect', { x: 3, y: 3, width: 7, height: 7, rx: 1 }],
      ['rect', { x: 14, y: 3, width: 7, height: 7, rx: 1 }],
      ['rect', { x: 14, y: 14, width: 7, height: 7, rx: 1 }],
      ['rect', { x: 3, y: 14, width: 7, height: 7, rx: 1 }],
    ],
  },
  dice: {
    shapes: [['rect', { x: 3, y: 3, width: 18, height: 18, rx: 3 }]],
    paths: ['M8 8h.01', 'M16 8h.01', 'M12 12h.01', 'M8 16h.01', 'M16 16h.01'],
  },
  'alarm-clock': {
    shapes: [['circle', { cx: 12, cy: 13, r: 8 }]],
    paths: ['M12 9v4l2 2', 'M5 3 2 6', 'm22 6-3-3', 'M6.4 18.7 4 21', 'M17.6 18.7 20 21'],
  },
  'bar-chart': {
    shapes: [
      ['rect', { x: 7, y: 13, width: 3, height: 5, rx: 0.5 }],
      ['rect', { x: 12, y: 6, width: 3, height: 12, rx: 0.5 }],
      ['rect', { x: 17, y: 10, width: 3, height: 8, rx: 0.5 }],
    ],
    paths: ['M3 3v18h18'],
  },
  timer: { shapes: [['circle', { cx: 12, cy: 14, r: 8 }]], paths: ['M10 2h4', 'M12 14l3-3'] },
  'chevron-up': { paths: ['m18 15-6-6-6 6'] },
  'chevron-down': { paths: ['m6 9 6 6 6-6'] },
  pin: {
    paths: [
      'M12 17v5',
      'M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
    ],
  },
  'check-circle': { shapes: [['circle', { cx: 12, cy: 12, r: 10 }]], paths: ['m9 12 2 2 4-4'] },
  tv: { shapes: [['rect', { x: 2, y: 7, width: 20, height: 15, rx: 2 }]], paths: ['m17 2-5 5-5-5'] },
  zap: { paths: ['M13 2 3 14h9l-1 8 10-12h-9z'] },
  flag: { paths: ['M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z', 'M4 22v-7'] },
  'trending-up': { paths: ['M22 7 13.5 15.5 8.5 10.5 2 17', 'M16 7h6v6'] },
  'octagon-x': { paths: ['M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z', 'm15 9-6 6', 'm9 9 6 6'] },
  hourglass: {
    paths: [
      'M5 22h14',
      'M5 2h14',
      { d: 'M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22', tone: true },
      { d: 'M7 2v4.2a2 2 0 0 0 .6 1.4L12 12l4.4-4.4A2 2 0 0 0 17 6.2V2', tone: true },
    ],
  },
  clock: { shapes: [['circle', { cx: 12, cy: 12, r: 10 }]], paths: ['M12 6v6l4 2'] },
  archive: {
    shapes: [['rect', { x: 2, y: 3, width: 20, height: 5, rx: 1 }]],
    paths: [{ d: 'M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8', tone: true }, 'M10 12h4'],
  },
  sprout: {
    paths: [
      'M7 20h10',
      'M10 20c5.5-2.5.8-6.4 3-10',
      'M9.5 9.4c1.1.8 1.8 2.2 2.3 3.7-2 .4-3.5.4-4.8-.3-1.2-.6-2.3-1.9-3-4.2 2.8-.5 4.4 0 5.5.8z',
      'M14.1 6a7 7 0 0 0-1.1 4c1.9-.1 3.3-.6 4.3-1.4 1-1 1.6-2.3 1.7-4.6-2.7.1-4 1-4.9 2z',
    ],
  },
  ruler: {
    paths: [
      'M21.3 15.3a2.4 2.4 0 0 1 0 3.4l-2.6 2.6a2.4 2.4 0 0 1-3.4 0L2.7 8.7a2.4 2.4 0 0 1 0-3.4l2.6-2.6a2.4 2.4 0 0 1 3.4 0z',
      'm14.5 12.5 2-2',
      'm11.5 9.5 2-2',
      'm8.5 6.5 2-2',
      'm17.5 15.5 2-2',
    ],
  },
  calendar: {
    shapes: [['rect', { x: 3, y: 4, width: 18, height: 18, rx: 2 }]],
    paths: ['M16 2v4', 'M8 2v4', 'M3 10h18'],
  },
  flame: {
    paths: [
      'M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z',
    ],
  },
};

export const ICON_NAMES = Object.keys(ICONS);

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

// the soft layer: the same shape filled with the text colour at low strength (the outline comes from the <svg>)
const soft = { fill: 'currentColor', 'fill-opacity': TONE_OPACITY, class: 'tone' };

// One icon. An unknown name gives an empty (but same-sized) icon rather than an error.
export function icon(name, extraClass = '') {
  const def = ICONS[name] || {};
  const svg = svgEl('svg', {
    class: `ico${extraClass ? ` ${extraClass}` : ''}`,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  for (const [tag, attrs] of def.shapes || []) svg.append(svgEl(tag, { ...attrs, ...soft }));
  for (const path of def.paths || []) {
    const d = typeof path === 'string' ? path : path.d;
    const toned = typeof path === 'string' ? /z$/i.test(path) : path.tone;
    svg.append(svgEl('path', toned ? { d, ...soft } : { d }));
  }
  return svg;
}

// Fill every <span data-icon="name"> inside `scope` with that icon (for HTML that is written out by hand).
export function hydrateIcons(scope) {
  for (const slot of scope.querySelectorAll('[data-icon]')) slot.replaceWith(icon(slot.dataset.icon, slot.hasAttribute('data-solo') ? 'solo' : ''));
}
