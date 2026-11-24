// The Master's family beyond the birth roll: how they react to the child's
// Magic Circuits, an optional brother or sister, the old lineages' heir
// decision (who receives the family's catalyst), and the war preparations
// the family gives through life events.
//
// state.master.family = {
//   standing: 'low' | 'below' | 'mid' | 'high' | 'exceptional',
//   sibling: null | { given, name, sex, older, age (at the war), rival, catalystId },
//   heir: null (undecided) | true | false,   // old lineages only
//   prep: { workshop, intel, manaMax },      // applied when the war begins
// }
// Saves from before this existed have no `family`; every helper copes.

import { getData, findById } from './data.js';
import { randInt, chance, pick, weightedPick } from './rng.js';
import { rankValue } from './ranks.js';
import { availableIn, entryName } from './period.js';
import { fits, fillText, applyEffects, makeContext } from './events.js';
import { gainRandomIntel } from './intel.js';

const STANDINGS = ['low', 'below', 'mid', 'high', 'exceptional'];

function cfg() {
  return getData('rules').family;
}

export function familyOf(state) {
  return state.master?.family || null;
}

// How the family sees the newborn's circuits: the average of quantity and
// quality (E=1 … A=5, EX=6), sorted into five bands.
export function circuitStanding(circuits) {
  const score = (rankValue(circuits.quantity) + rankValue(circuits.quality)) / 2;
  const cuts = cfg().standingCuts; // upper bounds for low, below, mid, high
  const i = cuts.findIndex((cut) => score < cut);
  return STANDINGS[i === -1 ? STANDINGS.length - 1 : i];
}

// Called from rollBirth, after the circuits and name are rolled.
// familyName: the family-name entry (string or { male, female }).
export function rollFamily(state, place, familyNameEntry) {
  const m = state.master;
  const family = findById('families', m.familyId);
  const standing = circuitStanding(m.circuits);
  let sibling = null;
  if (chance(family.siblingChance ?? 0)) {
    const sex = chance(0.5) ? 'male' : 'female';
    const gap = randInt(...cfg().siblingGap);
    // A younger sibling must still be old enough to fight in the war.
    const older = chance(0.5) || m.warAge - gap < cfg().minSiblingAge;
    const birthYear = m.birthYear + (older ? -gap : gap);
    const given = entryName(pick(availableIn(place.givenNames[sex], birthYear)));
    sibling = {
      given,
      name: `${given} ${entryName(familyNameEntry, sex)}`,
      sex,
      older,
      age: m.warAge + (older ? gap : -gap),
      rival: false,
      catalystId: null,
    };
  }
  m.family = { standing, sibling, heir: null, prep: { workshop: 0, intel: 0, manaMax: 0 } };
}

// The family's reaction at birth: a line of text, and (for mage families) a
// small change in what they invest in the child. Returns { text, lines }.
export function birthReaction(state, ctx) {
  const fam = familyOf(state);
  if (!fam) return { text: null, lines: [] };
  const texts = getData('family').reactions[state.master.familyId]?.[fam.standing] || [];
  const ok = texts.filter((t) => fits(t, ctx));
  const text = ok.length ? fillFamily(weightedPick(ok).text, state, ctx) : null;
  const family = findById('families', state.master.familyId);
  let effects = family.isMage ? cfg().reactionEffects[fam.standing] : null;
  // In a custom run, values typed by hand stay exactly as typed (custom.js).
  const c = state.custom;
  if (effects && c) {
    effects = JSON.parse(JSON.stringify(effects));
    if (Number.isFinite(c.money)) delete effects.money;
    if (Number.isFinite(c.contacts)) delete effects.contacts;
    for (const k of Object.keys(c.stats || {})) delete effects.stats?.[k];
  }
  const lines = applyEffects(state, effects, ctx);
  return { text, lines };
}

export function siblingIntro(state, ctx) {
  const sib = familyOf(state)?.sibling;
  if (!sib) return null;
  const list = getData('family').siblingBirth.filter((t) => fits(t, ctx) && (t.older === undefined || t.older === sib.older));
  return list.length ? fillFamily(weightedPick(list).text, state, ctx) : null;
}

// {sibling} → their given name, {siblingRelation} → brother / sister.
export function fillFamily(text, state, ctx) {
  const sib = familyOf(state)?.sibling;
  let out = fillText(text, ctx);
  if (sib) {
    out = out.replaceAll('{sibling}', sib.given).replaceAll('{siblingRelation}', relation(sib));
  }
  return out;
}

export function relation(sib) {
  return sib.sex === 'female' ? 'sister' : 'brother';
}

// ---- The heir decision (end of the life phase, old lineages only) ----

// Does the Master meet the family's expectations?
export function meetsExpectations(state) {
  const fam = familyOf(state);
  const c = cfg().heir;
  return c.standings.includes(fam.standing) || state.master.stats.magecraft >= c.magecraft;
}

// Decide who gets the family's catalyst. Returns story texts and effect
// lines to log, or null if this family has no heir decision.
export function decideHeir(state, ctx) {
  const fam = familyOf(state);
  const family = findById('families', state.master.familyId);
  if (!fam || !family.heirCatalyst || fam.heir !== null) return null;
  const t = getData('family').heir;
  const owned = state.master.catalysts;
  const pool = getData('catalysts').filter((c) => !owned.includes(c.id));
  const catalyst = pool.length ? weightedPick(pool, (c) => c.familyWeights?.[family.id] ?? 1) : null;
  const texts = [];
  const lines = [];
  if (meetsExpectations(state)) {
    fam.heir = true;
    texts.push(fillFamily(pickFits(t.chosen, ctx), state, ctx));
    if (catalyst) {
      owned.push(catalyst.id);
      texts.push(fillFamily(pickFits(t.gift, ctx), state, ctx).replaceAll('{catalyst}', lowerFirst(catalyst.name)));
      lines.push(`Catalyst received: ${catalyst.name}`);
    }
    if (fam.sibling) texts.push(fillFamily(pickFits(t.siblingAccepts, ctx), state, ctx));
  } else {
    fam.heir = false;
    if (fam.sibling && catalyst) {
      fam.sibling.rival = true;
      fam.sibling.catalystId = catalyst.id;
      texts.push(fillFamily(pickFits(t.passedOverSibling, ctx), state, ctx).replaceAll('{catalyst}', lowerFirst(catalyst.name)));
      texts.push(fillFamily(pickFits(t.siblingWillFight, ctx), state, ctx));
    } else {
      texts.push(fillFamily(pickFits(t.passedOver, ctx), state, ctx));
    }
  }
  return { texts, lines };
}

function pickFits(list, ctx) {
  const ok = list.filter((x) => fits(x, ctx));
  return weightedPick(ok.length ? ok : list).text;
}

function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// ---- War preparations (effect "prep" in life events) ----

export function addPrep(state, prep) {
  const fam = familyOf(state);
  if (!fam || !prep) return [];
  const lines = [];
  if (prep.workshop) {
    fam.prep.workshop = Math.min(3, fam.prep.workshop + prep.workshop);
    lines.push('Ready for the war: a workshop');
  }
  if (prep.intel) {
    fam.prep.intel += prep.intel;
    lines.push('Ready for the war: the family will gather intelligence');
  }
  if (prep.manaMax) {
    fam.prep.manaMax += prep.manaMax;
    lines.push(`Ready for the war: mana +${prep.manaMax} when it begins`);
  }
  return lines;
}

// The sibling who will fight in the war, or null.
export function rivalSibling(state) {
  const sib = familyOf(state)?.sibling;
  return sib?.rival ? sib : null;
}

// Make one generated rival the Master's sibling (called by generateRivals
// before the other rivals take the remaining Servants). Returns the Servant
// id the sibling's catalyst calls, avoiding the player's own Servant.
export function siblingServantId(state) {
  const sib = rivalSibling(state);
  if (!sib) return null;
  const catalyst = findById('catalysts', sib.catalystId);
  const options = (catalyst?.servants || []).filter((id) => id !== state.servant.id);
  return options.length ? pick(options) : null;
}

export function siblingRivalMaster(state, master, ctx) {
  const sib = rivalSibling(state);
  const t = getData('family');
  return {
    ...master,
    name: sib.name,
    sex: sib.sex,
    age: sib.age,
    originPlaceId: state.world.placeId,
    familyId: state.master.familyId,
    description: fillFamily(pick(t.siblingDescriptions), state, ctx),
    base: t.siblingBase,
  };
}

// A line from family.json's lists (warIntro, battle, eliminated) about the
// rival sibling, filled for this moment.
export function siblingLine(state, key) {
  if (!rivalSibling(state)) return null;
  const ctx = makeContext(state, { age: state.master.warAge, year: state.world.warYear, day: state.war?.day ?? 1 });
  const list = getData('family')[key].filter((t) => fits(t, ctx));
  return list.length ? fillText(weightedPick(list).text, ctx) : null;
}

// When the war begins: the family's preparations take effect. Returns
// effect lines and intel texts to log.
export function applyPrep(state) {
  const prep = familyOf(state)?.prep;
  const out = { lines: [], intel: [] };
  if (!prep) return out;
  if (prep.workshop && state.war.workshop < prep.workshop) {
    state.war.workshop = prep.workshop;
    out.lines.push(`Workshop: level ${prep.workshop}, prepared by your family`);
  }
  if (prep.manaMax) {
    const m = state.master.mana;
    m.max += prep.manaMax;
    m.current += prep.manaMax;
    out.lines.push(`Mana +${prep.manaMax} (${m.current}/${m.max})`);
  }
  for (let i = 0; i < prep.intel; i++) {
    const text = gainRandomIntel(state, { max: 1, exclude: state.rivals.filter((r) => r.sibling).map((r) => r.id) });
    if (text) out.intel.push(text);
  }
  return out;
}
