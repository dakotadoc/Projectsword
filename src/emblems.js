// Class emblems and symbols, drawn as small line-art SVGs (no image files).
// Static, trusted markup built with createElementNS: no data or AI text
// ever goes into an SVG.

const NS = 'http://www.w3.org/2000/svg';

export const CLASS_COLORS = {
  Saber: '#6a9cf0',
  Archer: '#e0b04a',
  Lancer: '#46c08f',
  Rider: '#c9814a',
  Caster: '#9b7be6',
  Assassin: '#8d96b8',
  Berserker: '#d8504a',
  Unknown: '#7a7890',
};

// Shapes on a 64×64 grid: [tag, attributes]. Strokes use currentColor.
const SHAPES = {
  Saber: [
    ['path', { d: 'M32 7 L36 13 L36 39 L28 39 L28 13 Z' }],
    ['path', { d: 'M19 40 H45' }],
    ['path', { d: 'M32 40 V52' }],
    ['circle', { cx: 32, cy: 55.5, r: 3 }],
  ],
  Archer: [
    ['path', { d: 'M22 9 Q48 32 22 55' }],
    ['path', { d: 'M22 9 L22 55' }],
    ['path', { d: 'M12 32 H52' }],
    ['path', { d: 'M46 27 L52 32 L46 37' }],
    ['path', { d: 'M12 32 L8 28 M12 32 L8 36' }],
  ],
  Lancer: [
    ['path', { d: 'M12 56 L44 18' }],
    ['path', { d: 'M41 18 L54 7 L46 22 Z' }],
    ['path', { d: 'M20 46 L14 44 M20 46 L18 52' }],
  ],
  Rider: [
    ['circle', { cx: 32, cy: 32, r: 20 }],
    ['circle', { cx: 32, cy: 32, r: 4 }],
    ['path', { d: 'M32 12 V28 M32 36 V52 M12 32 H28 M36 32 H52 M18 18 L29 29 M35 35 L46 46 M46 18 L35 29 M29 35 L18 46' }],
  ],
  Caster: [
    ['circle', { cx: 32, cy: 32, r: 23 }],
    ['path', { d: 'M32 11 L50 43 L14 43 Z' }],
    ['path', { d: 'M32 53 L14 21 L50 21 Z' }],
  ],
  Assassin: [
    ['path', { d: 'M27 7 L31 29 L27 36 L23 29 Z' }],
    ['path', { d: 'M18 36 H36' }],
    ['path', { d: 'M27 36 V48' }],
    ['path', { d: 'M48 34 A13 13 0 1 1 36 56 A10 10 0 1 0 48 34 Z' }],
  ],
  Berserker: [
    ['ellipse', { cx: 19, cy: 19, rx: 11, ry: 6, transform: 'rotate(45 19 19)' }],
    ['ellipse', { cx: 32, cy: 32, rx: 11, ry: 6, transform: 'rotate(-45 32 32)' }],
    ['path', { d: 'M40 40 L44 44 M48 42 L52 46 M42 48 L46 52' }],
  ],
  Unknown: [
    ['path', { d: 'M24 23 A8 8 0 1 1 35 30 Q32 32 32 38' }],
    ['circle', { cx: 32, cy: 46, r: 2 }],
  ],
  seal: [
    ['path', { d: 'M32 8 C22 18 22 32 32 38' }],
    ['path', { d: 'M32 38 C42 32 48 22 56 20' }],
    ['path', { d: 'M32 38 C27 46 18 50 8 46' }],
    ['path', { d: 'M22 26 C27 24 37 24 42 26' }],
    ['path', { d: 'M32 38 L32 56' }],
  ],
  grail: [
    ['path', { d: 'M18 12 H46 Q46 32 32 36 Q18 32 18 12 Z' }],
    ['path', { d: 'M32 36 V48' }],
    ['path', { d: 'M24 48 H40' }],
    ['path', { d: 'M20 54 H44' }],
  ],
  sun: [
    ['circle', { cx: 32, cy: 32, r: 10 }],
    ['path', { d: 'M32 8 V16 M32 48 V56 M8 32 H16 M48 32 H56 M15 15 L21 21 M43 43 L49 49 M49 15 L43 21 M21 43 L15 49' }],
  ],
  moon: [
    ['path', { d: 'M40 10 A22 22 0 1 0 54 42 A17 17 0 1 1 40 10 Z' }],
  ],
  knot: [
    ['circle', { cx: 24, cy: 32, r: 13 }],
    ['circle', { cx: 40, cy: 32, r: 13 }],
  ],
};

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

// A line-art icon. `draw`: give each stroke pathLength 1 so CSS can animate
// it being drawn (stroke-dashoffset from 1 to 0).
export function icon(name, { size = 64, draw = false, className = '' } = {}) {
  const svg = svgEl('svg', {
    viewBox: '0 0 64 64', width: size, height: size, fill: 'none', stroke: 'currentColor',
    'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', class: `icon icon-${name} ${className}`.trim(),
  });
  for (const [tag, attrs] of SHAPES[name] || SHAPES.Unknown) {
    svg.append(svgEl(tag, draw ? { ...attrs, pathLength: 1 } : attrs));
  }
  return svg;
}

// A round medallion with a class emblem in the class's color.
export function medallion(classId, { size = 40, className = '' } = {}) {
  const key = SHAPES[classId] ? classId : 'Unknown';
  const wrap = document.createElement('span');
  wrap.className = `medallion ${className}`.trim();
  wrap.style.setProperty('--emblem', CLASS_COLORS[key] || CLASS_COLORS.Unknown);
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;
  wrap.append(icon(key, { size: Math.round(size * 0.62) }));
  return wrap;
}

// The summoning circle used on the title screen and in the summoning scene.
export function summoningCircle({ size = 260, draw = false } = {}) {
  const svg = svgEl('svg', { viewBox: '0 0 200 200', width: size, height: size, fill: 'none', stroke: 'currentColor', 'aria-hidden': 'true', class: 'circle-svg' });
  const add = (tag, attrs) => svg.append(svgEl(tag, draw ? { ...attrs, pathLength: 1 } : attrs));
  add('circle', { cx: 100, cy: 100, r: 92, 'stroke-width': 2 });
  add('circle', { cx: 100, cy: 100, r: 82, 'stroke-width': 1 });
  add('circle', { cx: 100, cy: 100, r: 46, 'stroke-width': 1.5 });
  add('path', { d: 'M100 18 L171 141 L29 141 Z', 'stroke-width': 1.5 });
  add('path', { d: 'M100 182 L29 59 L171 59 Z', 'stroke-width': 1.5 });
  // Rune ticks around the ring.
  let ticks = '';
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const r2 = i % 2 ? 88 : 91;
    ticks += `M${(100 + Math.cos(a) * 83).toFixed(1)} ${(100 + Math.sin(a) * 83).toFixed(1)} L${(100 + Math.cos(a) * r2).toFixed(1)} ${(100 + Math.sin(a) * r2).toFixed(1)} `;
  }
  add('path', { d: ticks, 'stroke-width': 1.5 });
  return svg;
}

export const CLASSES = ['Saber', 'Archer', 'Lancer', 'Rider', 'Caster', 'Assassin', 'Berserker'];
