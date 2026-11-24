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
//   status: 'active',          // milestone 9 adds 'eliminated'
// }]
//
// Rival AI (milestone 9) uses `aggression` to choose between hunting and
// staying home.

import { getData, findById } from './data.js';
import { randInt, chance, pick, shuffle, weightedPick } from './rng.js';
import { availableIn, entryName } from './period.js';
import { fits, makeContext } from './events.js';

export function generateRivals(state) {
  const cfg = getData('rivals');
  const others = shuffle(getData('servants').filter((s) => s.id !== state.servant.id));
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

    return {
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
  });
}

export function activeRivals(state) {
  return (state.rivals || []).filter((r) => r.status === 'active');
}
