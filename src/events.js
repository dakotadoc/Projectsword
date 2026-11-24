// Random event engine, plus the condition / effect / text helpers that all
// data-driven content shares.
//
// A data entry (event, text variant, choice…) may restrict when it appears:
//   "from"/"to"         in-game years (see period.js)
//   "minAge"/"maxAge"   the Master's age
//   "conditions": { isMage, places, families, traits, sex, minMoney }
//
// Effects look like:
//   { "stats": { "body": 2 }, "money": -50, "contacts": 1, "catalyst": true }

import { getData, findById } from './data.js';
import { weightedPick } from './rng.js';
import { fitsYear } from './period.js';
import { findCatalyst } from './catalysts.js';

export const STAT_NAMES = { body: 'Body', magecraft: 'Magecraft', mind: 'Mind', charisma: 'Charisma' };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Facts about the current moment that conditions are checked against.
export function makeContext(state, { age, year }) {
  const family = findById('families', state.master.familyId);
  return {
    age,
    year,
    placeId: state.world.placeId,
    placeName: findById('places', state.world.placeId).name,
    familyId: family.id,
    isMage: family.isMage,
    traitId: state.master.traitId,
    sex: state.master.sex,
    money: state.master.money,
  };
}

export function fits(entry, ctx) {
  if (!fitsYear(entry, ctx.year)) return false;
  if (Number.isFinite(entry.minAge) && ctx.age < entry.minAge) return false;
  if (Number.isFinite(entry.maxAge) && ctx.age > entry.maxAge) return false;
  const c = entry.conditions;
  if (!c) return true;
  if (typeof c.isMage === 'boolean' && c.isMage !== ctx.isMage) return false;
  if (c.places && !c.places.includes(ctx.placeId)) return false;
  if (c.families && !c.families.includes(ctx.familyId)) return false;
  if (c.traits && !c.traits.includes(ctx.traitId)) return false;
  if (c.sex && c.sex !== ctx.sex) return false;
  if (Number.isFinite(c.minMoney) && ctx.money < c.minMoney) return false;
  return true;
}

// Pick one fitting text variant from a list of { text, ...restrictions }.
export function pickText(variants, ctx) {
  const ok = variants.filter((v) => fits(v, ctx));
  if (!ok.length) return null;
  return fillText(weightedPick(ok).text, ctx);
}

// Replace {place}, {year}, {age} in data text.
export function fillText(text, ctx) {
  return text
    .replaceAll('{place}', ctx.placeName)
    .replaceAll('{year}', String(ctx.year))
    .replaceAll('{age}', String(ctx.age));
}

// Roll one event for this phase that fits the moment and hasn't been seen.
export function rollEvent(phase, ctx, seenIds) {
  const pool = getData('events').filter(
    (e) => e.phase === phase && !seenIds.includes(e.id) && fits(e, ctx),
  );
  return pool.length ? weightedPick(pool) : null;
}

// Apply effects to state.master. Returns readable lines, e.g. "Body +3 (24)".
export function applyEffects(state, effects, ctx) {
  const m = state.master;
  const lines = [];
  if (!effects) return lines;
  for (const [key, delta] of Object.entries(effects.stats || {})) {
    const before = m.stats[key];
    m.stats[key] = clamp(before + delta, 0, 100);
    const actual = m.stats[key] - before;
    if (actual) lines.push(`${STAT_NAMES[key]} ${signed(actual)} (${m.stats[key]})`);
  }
  if (effects.money) {
    const before = m.money;
    m.money = Math.max(0, m.money + effects.money);
    if (m.money !== before) lines.push(`Money ${signed(m.money - before)} (${m.money})`);
  }
  if (effects.contacts) {
    const before = m.contacts;
    m.contacts = Math.max(0, m.contacts + effects.contacts);
    if (m.contacts !== before) lines.push(`Contacts ${signed(m.contacts - before)} (${m.contacts})`);
  }
  if (effects.catalyst) {
    const found = findCatalyst(state, ctx);
    if (found) lines.push(`Catalyst found: ${found.name}`);
  }
  return lines;
}

export function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}
