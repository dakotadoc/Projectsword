// Seeded random numbers. ALL randomness in the game goes through this file.
//
// The generator's position lives in state.rng ({ seed, s }), so saving and
// loading a game continues the exact same sequence, and starting a new game
// with the same seed replays the same rolls.

let rngState = null; // bound to state.rng by bindRng()

// Turn any seed text into a 32-bit number (FNV-1a hash).
export function hashSeed(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// A fresh random seed, as short readable text (e.g. "K3F9QZ").
export function makeSeed() {
  let n;
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    n = a[0];
  } catch {
    n = Math.floor(Math.random() * 2 ** 32);
  }
  return n.toString(36).toUpperCase();
}

export function createRngState(seed) {
  const text = String(seed).trim();
  return { seed: text, s: hashSeed(text) };
}

export function bindRng(state) {
  rngState = state;
}

// The one RNG function: returns a float in [0, 1). (mulberry32)
export function random() {
  if (!rngState) throw new Error('RNG used before a game was started.');
  rngState.s = (rngState.s + 0x6d2b79f5) >>> 0;
  let t = rngState.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Helpers built on random(). Never call Math.random() elsewhere.

// Whole number from min to max, both included.
export function randInt(min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

// True with probability p (0–1).
export function chance(p) {
  return random() < p;
}

export function pick(list) {
  return list[Math.floor(random() * list.length)];
}

// Pick one item by weight. By default reads item.weight (missing = 1).
export function weightedPick(list, getWeight = (item) => item.weight ?? 1) {
  const total = list.reduce((sum, item) => sum + Math.max(0, getWeight(item)), 0);
  if (total <= 0) return pick(list);
  let roll = random() * total;
  for (const item of list) {
    roll -= Math.max(0, getWeight(item));
    if (roll < 0) return item;
  }
  return list[list.length - 1];
}

// Shuffled copy; the original list is left alone.
export function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
