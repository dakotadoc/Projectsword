// Rival Masters: generated at the start of the war. Every war has all
// seven Servants: the player's, plus one each for the six rivals.
//
// state.rivals = [{
//   id: 'r1'..'r6',
//   master: { name, sex, age, originPlaceId, familyId, personalityId,
//             aggression (0–100: 0 stays in their bounded field, 100 hunts),
//             description, district, base },
//   servant: { id, hp: { current, max } },
//   intel: { master: 0–3, servant: 0–3 },  // what the player knows; see intel.js
//   (combat, milestone 8) master.stats/hp/mana/commandSeals/workshop,
//   knowsPlayerServant: true once they have seen the player's Noble Phantasm
//   status: 'active',          // milestone 9 adds 'eliminated'
// }]
//
// Rival AI (milestone 9) uses `aggression` to choose between hunting and
// staying home.

import { getData, findById } from './data.js';
import { randInt, chance, pick, shuffle, weightedPick } from './rng.js';
import { availableIn, entryName } from './period.js';
import { fits, makeContext } from './events.js';
import { rivalSibling, siblingServantId, siblingRivalMaster } from './family.js';

export function generateRivals(state) {
  const cfg = getData('rivals');
  let others = shuffle(getData('servants').filter((s) => s.id !== state.servant.id));
  // A sibling who took the family's catalyst is the first rival, with the
  // Servant that catalyst calls (family.js).
  const sibling = rivalSibling(state);
  const sibServant = siblingServantId(state);
  if (sibServant) others = [others.find((s) => s.id === sibServant), ...others.filter((s) => s.id !== sibServant)];
  const ctx = makeContext(state, { age: state.master.warAge, year: state.world.warYear });
  const places = getData('places');
  const warPlace = findById('places', state.world.placeId);
  const usedDistricts = [];
  const usedBases = [];
  const usedNames = new Set([state.master.name]);

  state.rivals = others.slice(0, cfg.count).map((servant, i) => {
    const sex = chance(0.5) ? 'male' : 'female';
    const age = randInt(...cfg.age);
    const birthYear = state.world.warYear - age;
    const origin = chance(cfg.foreignChance) ? pick(places.filter((p) => p.id !== warPlace.id)) : warPlace;

    let name;
    for (let tries = 0; tries < 10; tries++) {
      const given = entryName(pick(availableIn(origin.givenNames[sex], birthYear)));
      name = `${given} ${entryName(pick(origin.familyNames), sex)}`;
      if (!usedNames.has(name)) break;
    }
    usedNames.add(name);

    const familyId = weightedPick(Object.entries(cfg.familyWeights).map(([id, weight]) => ({ id, weight }))).id;
    const personality = weightedPick(cfg.personalities);
    const openDistricts = warPlace.districts.filter((d) => !usedDistricts.includes(d));
    const district = pick(openDistricts.length ? openDistricts : warPlace.districts);
    usedDistricts.push(district);
    // Every rival gets a different base (if there are enough to go round).
    const fitting = cfg.bases.filter((b) => fits(b, ctx));
    const freshBases = fitting.filter((b) => !usedBases.includes(b.text));
    const base = weightedPick(freshBases.length ? freshBases : fitting).text;
    usedBases.push(base);

    const rival = {
      id: `r${i + 1}`,
      master: {
        name, sex, age, originPlaceId: origin.id, familyId,
        personalityId: personality.id,
        aggression: randInt(...personality.aggression),
        description: pick(personality.descriptions),
        district, base,
      },
      servant: { id: servant.id, hp: { current: servant.hp, max: servant.hp } },
      intel: { master: 0, servant: 0 }, // what the player knows (intel.js)
      status: 'active',
    };
    if (sibling && i === 0) {
      // The player knows their own sibling, and which relic they hold (so
      // the class); the sibling knows where the player lives.
      rival.master = siblingRivalMaster(state, rival.master, ctx);
      rival.sibling = true;
      rival.intel = { master: 3, servant: 1 };
      rival.knows = { player: 2 };
    }
    return rival;
  });
  ensureRivalCombatStats(state);
}

// Combat stats for rival Masters (milestone 8): Body, Magecraft, Mind, HP,
// mana, Command Seals and a workshop at their base. Also fills them in for
// saves made before combat existed.
export function ensureRivalCombatStats(state) {
  const cfg = getData('rivals');
  const ms = cfg.masterStats;
  const combat = getData('rules').combat;
  for (const rival of state.rivals || []) {
    const m = rival.master;
    if (m.stats) continue;
    m.stats = {
      body: randInt(...ms.body),
      magecraft: randInt(...ms.magecraft[m.familyId]),
      mind: randInt(...ms.mind),
      charisma: randInt(...ms.charisma),
    };
    const hp = Math.round(combat.masterHp.base + combat.masterHp.perBody * m.stats.body);
    m.hp = { current: hp, max: hp };
    const mana = ms.manaBase + m.stats.magecraft;
    m.mana = { current: mana, max: mana };
    m.commandSeals = 3;
    const isCaster = findById('servants', rival.servant.id).class === 'Caster';
    m.workshop = Math.min(3, randInt(...cfg.workshop[m.personalityId]) + (isCaster ? cfg.workshop.casterBonus : 0));
    rival.knowsPlayerServant = false; // set when the player's true name is revealed to them
  }
}

export function activeRivals(state) {
  return (state.rivals || []).filter((r) => r.status === 'active');
}
