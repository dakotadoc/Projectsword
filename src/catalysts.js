// Summoning catalysts: finding them during the life phase.
// (Milestone 4 maps each catalyst to the Servant it summons.)

import { getData, findById } from './data.js';
import { weightedPick } from './rng.js';
import { fitsYear } from './period.js';

// Picks a catalyst the Master doesn't own yet, weighted by birthplace and
// family, adds it to state.master.catalysts, and returns it (or null).
export function findCatalyst(state, ctx) {
  const owned = state.master.catalysts;
  const pool = getData('catalysts').filter((c) => !owned.includes(c.id) && fitsYear(c, ctx.year));
  if (!pool.length) return null;
  const found = weightedPick(pool, (c) =>
    (c.weight ?? 1) * (c.placeWeights?.[ctx.placeId] ?? 1) * (c.familyWeights?.[ctx.familyId] ?? 1));
  owned.push(found.id);
  return found;
}

// Chance (0–1) that a relic search turn succeeds.
export function relicSearchChance(state, years) {
  const r = getData('rules').relicSearch;
  const m = state.master;
  const family = findById('families', m.familyId);
  const trait = findById('traits', m.traitId);
  const chance =
    r.base +
    r.perExtraYear * (years - 1) +
    r.perContact * m.contacts +
    r.perMind * m.stats.mind +
    (family.relicChance ?? 0) +
    (trait.effects?.relicChance ?? 0);
  return Math.min(r.max, chance);
}
