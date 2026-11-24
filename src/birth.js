// Phase 1: Birth. The player chooses to be born a boy or a girl; then the
// place, era, family, Magic Circuits, trait and name are rolled once, stored
// in state, and shown as a birth certificate.

import * as ui from './ui.js';
import { getState } from './state.js';
import { getData, findById } from './data.js';
import { randInt, pick, weightedPick } from './rng.js';
import { RANKS, rankValue } from './ranks.js';
import { availableIn, entryName } from './period.js';

export const SEXES = { male: 'Boy', female: 'Girl' };

const STAT_KEYS = ['body', 'magecraft', 'mind', 'charisma'];
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const rollRange = ([min, max]) => randInt(min, max);

// Rolls a new character into state.world and state.master.
// sex: 'male' or 'female' (chosen by the player).
export function rollBirth(state, sex) {
  if (!(sex in SEXES)) throw new Error(`Unknown sex: ${sex}`);
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
  const birthYear = warYear - warAge;
  // Only names that were in use in the birth year (see period.js).
  const givenName = entryName(pick(availableIn(place.givenNames[sex], birthYear)));

  state.world = { placeId: place.id, eraId: era.id, warYear };
  state.master = {
    name: `${givenName} ${entryName(pick(place.familyNames), sex)}`,
    sex,
    birthYear,
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

// The birth screen. First asks boy or girl, then rolls and shows the
// certificate. On resume the log already holds whatever was shown.
export async function birthScreen({ resumed = false, goTo, autosave }) {
  const state = getState();
  if (!state.master) {
    if (!resumed) {
      ui.log('Birth', 'heading');
      ui.log('Will you be born a boy or a girl?', 'system');
    }
    ui.setChoices(Object.entries(SEXES).map(([sex, label]) => ({
      label: `Born a ${label.toLowerCase()}`,
      onSelect: async () => {
        rollBirth(state, sex);
        showBirth(state);
        showBirthChoices(goTo);
        await autosave();
      },
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

  ui.log(place.birthText);
  ui.log(family.birthText);
  ui.log(era.description);
  ui.log([
    'Certificate of birth',
    `Name: ${master.name}`,
    `Born: ${place.name}, ${place.country}, ${master.birthYear}`,
    `Sex: ${SEXES[master.sex]}`,
    `Era: ${era.name}`,
    `Family: ${family.name}`,
    `Magic Circuits: quantity ${master.circuits.quantity}, quality ${master.circuits.quality}`,
    `Trait: ${trait.name}. ${trait.description}`,
    `Body ${s.body} · Magecraft ${s.magecraft} · Mind ${s.mind} · Charisma ${s.charisma}`,
    `Mana ${master.mana.max} · Money ${master.money} · Contacts ${master.contacts}`,
  ].join('\n'), 'card');
}
