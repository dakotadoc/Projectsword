// Phase 1: Birth. Rolls the place, era, family, Magic Circuits and trait once,
// stores the result in state, and shows it as a birth certificate.

import * as ui from './ui.js';
import { getState } from './state.js';
import { getData, findById } from './data.js';
import { randInt, pick, weightedPick } from './rng.js';
import { RANKS, rankValue } from './ranks.js';

const STAT_KEYS = ['body', 'magecraft', 'mind', 'charisma'];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const rollRange = ([min, max]) => randInt(min, max);

// Rolls a new character into state.world and state.master.
export function rollBirth(state) {
  const rules = getData('rules');
  const place = weightedPick(getData('places'));
  const era = weightedPick(getData('eras'));
  const family = weightedPick(getData('families'));
  const trait = weightedPick(getData('traits'));

  // The war's year comes from the era; birth is counted back from it.
  const warYear = rollRange(era.warYears);
  const warAge = rollRange(rules.warAge);

  const weights = family.circuitWeights;
  const rollRank = () => weightedPick(RANKS, (r) => weights[r] ?? 0);
  const circuits = { quantity: rollRank(), quality: rollRank() };

  const stats = {};
  for (const key of STAT_KEYS) stats[key] = rollRange(family.stats[key]);
  const fx = trait.effects || {};
  for (const [key, delta] of Object.entries(fx.stats || {})) {
    if (key in stats) stats[key] += delta;
  }
  for (const key of STAT_KEYS) stats[key] = clamp(stats[key], 0, 100);

  const manaMax = rankValue(circuits.quantity) * rules.manaPerCircuitRank;

  state.world = { placeId: place.id, eraId: era.id, warYear };
  state.master = {
    name: `${pick(place.givenNames)} ${pick(place.familyNames)}`,
    birthYear: warYear - warAge,
    warAge,
    familyId: family.id,
    traitId: trait.id,
    circuits,
    stats,
    mana: { current: manaMax, max: manaMax },
    money: Math.max(0, rollRange(family.money) + (fx.money || 0)),
    contacts: Math.max(0, rollRange(family.contacts) + (fx.contacts || 0)),
    commandSeals: 0, // the three seals appear when the war is announced
  };
}

// The birth screen. Rolls on first visit; on resume the log already holds it.
export async function birthScreen({ resumed = false, goTo }) {
  const state = getState();
  if (!resumed) {
    if (!state.master) rollBirth(state);
    showBirth(state);
  }
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

  ui.log('Birth', 'heading');
  ui.log(place.birthText);
  ui.log(family.birthText);
  ui.log(era.description);
  ui.log([
    'Certificate of birth',
    `Name: ${master.name}`,
    `Born: ${place.name}, ${place.country}, ${master.birthYear}`,
    `Era: ${era.name}`,
    `Family: ${family.name}`,
    `Magic Circuits: quantity ${master.circuits.quantity}, quality ${master.circuits.quality}`,
    `Trait: ${trait.name}. ${trait.description}`,
    `Body ${s.body} · Magecraft ${s.magecraft} · Mind ${s.mind} · Charisma ${s.charisma}`,
    `Mana ${master.mana.max} · Money ${master.money} · Contacts ${master.contacts}`,
  ].join('\n'), 'card');
}
