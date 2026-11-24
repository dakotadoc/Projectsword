// Phase 1: Birth. The player chooses to be born a boy or a girl; then the
// place, era, family, Magic Circuits, trait and name are rolled once, stored
// in state, and shown as a birth certificate.

import * as ui from './ui.js';
import { getState } from './state.js';
import { getData, findById } from './data.js';
import { randInt, pick, weightedPick } from './rng.js';
import { RANKS, rankValue } from './ranks.js';
import { availableIn, entryName } from './period.js';
import { playScene } from './fx.js';
import { rollFamily, birthReaction, siblingIntro, familyOf, relation } from './family.js';
import { makeContext } from './events.js';

export const SEXES = { male: 'Boy', female: 'Girl' };

const STAT_KEYS = ['body', 'magecraft', 'mind', 'charisma'];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const rollRange = ([min, max]) => randInt(min, max);

// Rolls a new character into state.world and state.master.
// sex: 'male' or 'female' (chosen by the player).
// custom (custom runs, custom.js): anything the player chose by hand
// overrides the roll. With no custom choices the rolls happen in exactly the
// same order as always, so old seeds still give the same runs.
export function rollBirth(state, sex, custom = null) {
  if (!(sex in SEXES)) throw new Error(`Unknown sex: ${sex}`);
  const c = custom || {};
  const rules = getData('rules');
  const place = c.placeId ? findById('places', c.placeId) : weightedPick(getData('places'));
  let era = c.birthYear ? null : weightedPick(getData('eras'));
  const family = c.familyId ? findById('families', c.familyId) : weightedPick(getData('families'));
  const trait = c.traitId ? findById('traits', c.traitId) : weightedPick(getData('traits'));

  // The war's year comes from the era; birth is counted back from it. A
  // custom birth year works the other way: the era is the one the war falls in.
  let warYear = era ? rollRange(era.warYears) : null;
  const warAge = c.warAge ?? rollRange(c.warAgeRange || rules.warAge);
  if (c.birthYear) {
    warYear = c.birthYear + warAge;
    era = eraForYear(warYear);
  }

  const weights = family.circuitWeights;
  const rollRank = () => weightedPick(RANKS, (r) => weights[r] ?? 0);
  const circuits = { quantity: c.quantity || rollRank(), quality: c.quality || rollRank() };

  const stats = {};
  for (const key of STAT_KEYS) stats[key] = rollRange(family.stats[key]);
  const fx = trait.effects || {};
  for (const [key, delta] of Object.entries(fx.stats || {})) {
    if (key in stats) stats[key] += delta;
  }
  for (const key of STAT_KEYS) {
    if (Number.isFinite(c.stats?.[key])) stats[key] = c.stats[key];
    stats[key] = clamp(stats[key], 0, 100);
  }

  const manaMax = rankValue(circuits.quantity) * rules.manaPerCircuitRank;
  const birthYear = warYear - warAge;
  // Only names that were in use in the birth year (see period.js).
  const givenList = availableIn(place.givenNames[sex], birthYear);
  const givenName = entryName(pick(givenList.length ? givenList : place.givenNames[sex]));
  let familyName = pick(place.familyNames);
  let name = `${givenName} ${entryName(familyName, sex)}`;
  if (c.name) {
    name = c.name;
    // A typed family name is shared by a sibling as it is.
    const parts = c.name.trim().split(/\s+/);
    if (parts.length > 1) familyName = parts.slice(1).join(' ');
  }
  const money = Math.max(0, rollRange(family.money) + (fx.money || 0));
  const contacts = Math.max(0, rollRange(family.contacts) + (fx.contacts || 0));

  state.world = { placeId: place.id, eraId: era.id, warYear };
  state.master = {
    name,
    sex,
    birthYear,
    warAge,
    familyId: family.id,
    traitId: trait.id,
    circuits,
    stats,
    mana: { current: manaMax, max: manaMax },
    money: Number.isFinite(c.money) ? c.money : money,
    contacts: Number.isFinite(c.contacts) ? c.contacts : contacts,
    commandSeals: 0, // the three seals appear when the war is announced
    catalysts: [...(c.catalysts || [])], // catalyst ids found during the life phase
  };
  rollFamily(state, place, familyName);
}

// The era a war year falls in (or the nearest one).
export function eraForYear(year) {
  const eras = getData('eras');
  const inside = eras.find((e) => year >= e.warYears[0] && year <= e.warYears[1]);
  if (inside) return inside;
  const dist = (e) => Math.min(Math.abs(year - e.warYears[0]), Math.abs(year - e.warYears[1]));
  return eras.reduce((a, b) => (dist(b) < dist(a) ? b : a));
}

// The birth screen. First asks boy or girl, then rolls and shows the
// certificate. On resume the log already holds whatever was shown.
export async function birthScreen({ resumed = false, goTo, autosave }) {
  const state = getState();
  const born = async (sex) => {
    rollBirth(state, sex, state.custom);
    const place = findById('places', state.world.placeId);
    await playScene('birth', { year: state.master.birthYear, place: `${place.name}, ${place.country}` }, { gate: false });
    showBirth(state);
    showBirthChoices(goTo);
    await autosave();
  };
  if (!state.master) {
    if (!resumed) ui.log('Birth', 'heading');
    // A custom run already chose boy or girl in its form (custom.js).
    if (state.custom?.sex) {
      await born(state.custom.sex);
      return;
    }
    if (!resumed) ui.log('Will you be born a boy or a girl?', 'system');
    ui.setChoices(Object.entries(SEXES).map(([sex, label]) => ({
      label: `Born a ${label.toLowerCase()}`,
      onSelect: () => born(sex),
    })));
    return;
  }
  showBirthChoices(goTo);
}

function showBirthChoices(goTo) {
  ui.setChoices([
    { label: 'Begin your life', style: 'primary', onSelect: () => goTo('life') },
  ]);
}

function showBirth(state) {
  const { master, world } = state;
  const place = findById('places', world.placeId);
  const era = findById('eras', world.eraId);
  const family = findById('families', master.familyId);
  const trait = findById('traits', master.traitId);
  const s = master.stats;

  const ctx = makeContext(state, { age: 0, year: master.birthYear });
  ui.log(place.birthText);
  ui.log(family.birthText);
  const reaction = birthReaction(state, ctx);
  if (reaction.text) ui.log(reaction.text);
  if (reaction.lines.length) ui.log(reaction.lines.join(' · '), 'effect');
  const sibText = siblingIntro(state, ctx);
  if (sibText) ui.log(sibText);
  const sib = familyOf(state)?.sibling;
  ui.log(era.description);
  ui.log([
    'Certificate of birth',
    `Name: ${master.name}`,
    `Born: ${place.name}, ${place.country}, ${master.birthYear}`,
    `Sex: ${SEXES[master.sex]}`,
    `Era: ${era.name}`,
    `Family: ${family.name}`,
    ...(sib?.older ? [`Older ${relation(sib)}: ${sib.name}`] : []),
    `Magic Circuits: quantity ${master.circuits.quantity}, quality ${master.circuits.quality}`,
    `Trait: ${trait.name}. ${trait.description}`,
    `Body ${s.body} · Magecraft ${s.magecraft} · Mind ${s.mind} · Charisma ${s.charisma}`,
    `Mana ${master.mana.max} · Money ${master.money} · Contacts ${master.contacts}`,
  ].join('\n'), 'document');
}
