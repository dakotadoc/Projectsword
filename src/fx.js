// Animated scenes for major moments (birth, the Command Seals, the
// summoning, battles, the Grail…), shown full-screen over the game.
//
// playScene(name, data) resolves when the scene ends; tap (or Space/Enter)
// skips it. banner(name, data) is a small, non-blocking announcement.
// With "reduce motion" turned on, scenes are skipped entirely.
// All text from data goes in with textContent.

import { icon, medallion, summoningCircle, CLASSES, CLASS_COLORS } from './emblems.js';
import * as ui from './ui.js';

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const root = () => document.getElementById('fx-root');

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

// ---- Scenes: each returns { node, duration } ----

const SCENES = {
  // First light, then the year and the city.
  birth({ year, place }) {
    const node = el('div');
    node.append(el('div', 'fx-dawn'), el('div', 'fx-stack',));
    const stack = node.lastChild;
    stack.append(el('p', 'fx-kicker', 'You are born'), el('h2', 'fx-big', String(year)), el('p', 'fx-sub', place));
    return { node, duration: 3600 };
  },

  // The Command Seals burn onto the Master's hand.
  seals() {
    const node = el('div');
    const stack = el('div', 'fx-stack');
    const glyph = icon('seal', { size: 170, draw: true, className: 'fx-draw fx-seal-glyph' });
    stack.append(glyph, el('h2', 'fx-title', 'Command Seals'), el('p', 'fx-sub', 'The Grail has chosen you.'));
    node.append(el('div', 'fx-ember'), stack);
    return { node, duration: 4200 };
  },

  // The circle draws itself, spins, flashes; the Servant appears.
  summon({ cls, name }) {
    const node = el('div');
    const circle = el('div', 'fx-circle');
    circle.append(summoningCircle({ size: 280, draw: true }));
    const flash = el('div', 'fx-flash');
    const reveal = el('div', 'fx-stack fx-reveal');
    reveal.append(medallion(cls, { size: 120, className: 'fx-medallion' }), el('p', 'fx-kicker', 'Servant'), el('h2', 'fx-title', cls), el('p', 'fx-sub', name));
    node.style.setProperty('--emblem', CLASS_COLORS[cls] || CLASS_COLORS.Unknown);
    node.append(circle, flash, reveal);
    return { node, duration: 6200 };
  },

  // The seven classes take their places.
  warStart({ place, year }) {
    const node = el('div');
    const ring = el('div', 'fx-ring');
    CLASSES.forEach((c, i) => {
      const m = medallion(c, { size: 54, className: 'fx-ring-item' });
      const a = (i / CLASSES.length) * Math.PI * 2 - Math.PI / 2;
      m.style.setProperty('--x', `${Math.cos(a) * 120}px`);
      m.style.setProperty('--y', `${Math.sin(a) * 120}px`);
      m.style.animationDelay = `${0.25 + i * 0.18}s`;
      ring.append(m);
    });
    const stack = el('div', 'fx-stack fx-center');
    stack.append(el('h2', 'fx-title', 'The Holy Grail War'), el('p', 'fx-sub', `${place}, ${year}`));
    node.append(ring, stack);
    return { node, duration: 4400 };
  },

  // Your emblem against theirs.
  battle({ yourClass, enemyClass, label }) {
    const node = el('div');
    const row = el('div', 'fx-versus');
    row.append(
      medallion(yourClass || 'Unknown', { size: 96, className: 'fx-left' }),
      el('span', 'fx-vs', 'vs'),
      medallion(enemyClass || 'Unknown', { size: 96, className: 'fx-right' }),
    );
    node.append(el('div', 'fx-slash'), row, el('p', 'fx-sub fx-battle-label', label || 'Battle'));
    return { node, duration: 2200 };
  },

  // A Noble Phantasm: a flash and its name.
  np({ name, cls, enemy }) {
    const node = el('div');
    node.style.setProperty('--emblem', CLASS_COLORS[cls] || CLASS_COLORS.Unknown);
    const stack = el('div', 'fx-stack');
    stack.append(el('p', 'fx-kicker', enemy ? 'Enemy Noble Phantasm' : 'Noble Phantasm'), el('h2', 'fx-title fx-np-name', name));
    node.append(el('div', 'fx-flash fx-flash-now'), el('div', 'fx-np-beam'), stack);
    return { node, duration: 2600 };
  },

  // The relationship path is chosen.
  path({ path, name }) {
    const node = el('div');
    const stack = el('div', 'fx-stack');
    stack.append(icon('knot', { size: 150, draw: true, className: `fx-draw fx-knot fx-knot-${path}` }),
      el('h2', 'fx-title', path === 'romantic' ? 'Beloved' : 'Comrades'), el('p', 'fx-sub', name));
    node.append(stack);
    return { node, duration: 3200 };
  },

  // The Grail appears.
  grail() {
    const node = el('div');
    const stack = el('div', 'fx-stack');
    stack.append(icon('grail', { size: 170, draw: true, className: 'fx-draw fx-grail-icon' }), el('h2', 'fx-title', 'The Grail'));
    node.append(el('div', 'fx-gold'), stack);
    return { node, duration: 4400 };
  },

  // The Servant is lost.
  servantLost({ cls, name }) {
    const node = el('div');
    const stack = el('div', 'fx-stack');
    stack.append(medallion(cls, { size: 110, className: 'fx-fading' }), el('p', 'fx-sub', `${name} is gone.`));
    node.append(stack);
    return { node, duration: 3200 };
  },

  // Defeat: a slow fade to black.
  defeat({ line }) {
    const node = el('div');
    node.append(el('p', 'fx-sub fx-defeat-line', line || 'Your war is over.'));
    return { node, duration: 3400 };
  },
};

// Scenes never start on their own: once the text above has finished typing,
// a Continue button appears, and the scene plays when the player taps it.
// { gate: false } skips that step when the tap that led here was just made
// (e.g. choosing to be born a boy or a girl).
export async function playScene(name, data = {}, { gate = true } = {}) {
  const make = SCENES[name];
  if (!make || reducedMotion() || !root()) return;
  if (gate) await waitForTap();
  await runScene(make, name, data);
}

function waitForTap() {
  return ui.afterTyping().then(() => new Promise((resolve) => {
    ui.setChoices([{ label: 'Continue', style: 'primary', onSelect: () => { ui.setChoices([]); resolve(); } }]);
  }));
}

function runScene(make, name, data) {
  return new Promise((resolve) => {
    const { node, duration } = make(data);
    node.classList.add('fx-scene', `fx-${name}`);
    node.append(el('span', 'fx-skip', 'Tap to continue'));
    root().append(node);
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      document.removeEventListener('keydown', onKey);
      node.classList.add('fx-out');
      setTimeout(() => { node.remove(); resolve(); }, 380);
    };
    const onKey = (e) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        finish();
      }
    };
    const timer = setTimeout(finish, duration);
    node.addEventListener('click', finish);
    document.addEventListener('keydown', onKey);
  });
}

// A small banner at the top that doesn't block play (e.g. "Day 3", "Night").
export function banner(name, text) {
  if (reducedMotion() || !root()) return;
  const node = el('div', `fx-banner fx-banner-${name}`);
  node.append(icon(name === 'night' ? 'moon' : name === 'day' ? 'sun' : 'knot', { size: 26 }), el('span', '', text));
  root().append(node);
  setTimeout(() => node.remove(), 2200);
}
