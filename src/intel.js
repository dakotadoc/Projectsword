// The hidden-information system: what the player knows about each rival.
//
// Each rival has rival.intel = { master: 0–3, servant: 0–3 }.
//   Master  1: description and rough location (district)  → can scout
//           2: name and base                               → can ambush
//           3: family, age, origin, personality, aggression
//   Servant 1: class
//           2: stat ranks
//           3: true name, Noble Phantasm, weakness
//
// knownView() is the ONE place that turns a rival into what the player
// knows. The Status tab and the AI context both use it, so neither can show
// something the player hasn't learned. Unknown values are null ("???").

import { getData, findById } from './data.js';
import { weightedPick, chance } from './rng.js';
import { fits, makeContext } from './events.js';
import { activeRivals } from './rivals.js';

export const MAX_LEVEL = 3;

// The name the player uses for a rival right now.
export function rivalLabel(rival) {
  const k = rival.intel;
  if (k.servant >= 1) return `the ${findById('servants', rival.servant.id).class}'s Master`;
  if (k.master >= 2) return rival.master.name;
  if (k.master >= 1) return `the Master in ${rival.master.district}`;
  return 'an unknown Master';
}

// Short title for lists: "Lancer", or "Unknown Servant".
export function rivalTitle(rival) {
  const k = rival.intel;
  const servant = k.servant >= 1 ? findById('servants', rival.servant.id).class : 'Unknown Servant';
  const master = k.master >= 2 ? rival.master.name : k.master >= 1 ? `Master in ${rival.master.district}` : 'Unknown Master';
  return `${servant} · ${master}`;
}

// Raise one track by one level (up to `max`). Returns the reveal text, or
// null if nothing new was learned.
export function gainIntel(state, rival, track, { max = MAX_LEVEL } = {}) {
  const level = rival.intel[track];
  if (level >= Math.min(max, MAX_LEVEL)) return null;
  const label = rivalLabel(rival); // before the new knowledge
  rival.intel[track] = level + 1;
  const ctx = makeContext(state, { age: state.master.warAge, year: state.world.warYear, day: state.war?.day });
  const variants = getData('rivals').intelTexts[`${track}${level + 1}`].filter((t) => fits(t, ctx));
  return fillIntel(weightedPick(variants).text, rival, label);
}

// Learn one new thing about some rival (gathering, contacts, events).
// Prefers rivals the player knows least about. Returns text or null.
export function gainRandomIntel(state, { max = 2 } = {}) {
  const options = [];
  for (const rival of activeRivals(state)) {
    for (const track of ['master', 'servant']) {
      if (rival.intel[track] < max) {
        const known = rival.intel.master + rival.intel.servant;
        options.push({ rival, track, weight: (2 * MAX_LEVEL + 1 - known) * (track === 'master' ? 1.2 : 1) });
      }
    }
  }
  if (!options.length) return null;
  // Learn the lower track first, so knowledge builds up in order.
  const pickd = weightedPick(options);
  const { rival } = pickd;
  const track = rival.intel.master === rival.intel.servant ? pickd.track
    : rival.intel.master < rival.intel.servant ? 'master' : 'servant';
  return gainIntel(state, rival, track, { max });
}

// Chance (0–1) that a day of gathering intel turns something up.
export function gatherChance(state) {
  const r = getData('rules').intel;
  const m = state.master;
  return Math.min(r.gatherMax, r.gatherBase + r.gatherPerMind * m.stats.mind + r.gatherPerContact * m.contacts);
}

// At dawn, contacts may bring a tip.
export function contactTip(state) {
  const r = getData('rules').intel;
  if (!state.master.contacts) return null;
  if (!chance(Math.min(r.contactTipMax, r.contactTipPerContact * state.master.contacts))) return null;
  return gainRandomIntel(state, { max: 2 });
}

// ---- What the player knows ----

// A rival as the player knows it. Every unknown field is null.
export function knownView(rival) {
  const k = rival.intel;
  const m = rival.master;
  const s = findById('servants', rival.servant.id);
  return {
    id: rival.id,
    title: rivalTitle(rival),
    status: rival.status,
    master: {
      level: k.master,
      description: k.master >= 1 ? m.description : null,
      district: k.master >= 1 ? m.district : null,
      name: k.master >= 2 ? m.name : null,
      base: k.master >= 2 ? m.base : null,
      sex: k.master >= 2 ? m.sex : null,
      family: k.master >= 3 ? findById('families', m.familyId).name : null,
      age: k.master >= 3 ? m.age : null,
      origin: k.master >= 3 ? findById('places', m.originPlaceId).name : null,
      personality: k.master >= 3 ? personality(m.personalityId).name : null,
      aggression: k.master >= 3 ? m.aggression : null,
    },
    servant: {
      level: k.servant,
      class: k.servant >= 1 ? s.class : null,
      stats: k.servant >= 2 ? s.stats : null,
      trueName: k.servant >= 3 ? s.trueName : null,
      noblePhantasm: k.servant >= 3 ? s.noblePhantasm : null,
      weakness: k.servant >= 3 ? s.weakness : null,
    },
  };
}

// Lines for the Servant's AI context: only what the player knows.
export function knownSummaryLines(state) {
  const rivals = state.rivals || [];
  if (!rivals.some((r) => r.intel.master || r.intel.servant)) {
    return [`There are ${rivals.length} other Masters. Nothing is known yet about who they are or what their Servants are.`];
  }
  const lines = [`There are ${rivals.length} other Masters. What your Master has learned about them (anything not listed is unknown to you):`];
  for (const r of rivals) {
    const v = knownView(r);
    const parts = [];
    if (v.servant.class) parts.push(`Servant class: ${v.servant.class}`);
    if (v.servant.stats) parts.push(`Servant parameters: ${Object.entries(v.servant.stats).map(([k, x]) => `${k} ${x}`).join(', ')}`);
    if (v.servant.trueName) parts.push(`Servant's true name: ${v.servant.trueName}; Noble Phantasm: ${v.servant.noblePhantasm.name}; weakness: ${v.servant.weakness}`);
    if (v.master.name) parts.push(`Master's name: ${v.master.name}`);
    if (v.master.district) parts.push(`seen around ${v.master.district}`);
    if (v.master.base) parts.push(`base: ${v.master.base}`);
    if (v.master.description) parts.push(`described as: ${v.master.description.replace(/[.!?]$/, '')}`);
    if (v.master.personality) parts.push(`personality: ${v.master.personality}, ${v.master.family}, age ${v.master.age}, from ${v.master.origin}`);
    lines.push(parts.length ? `- ${parts.join('; ')}.` : '- One Master you know nothing about.');
  }
  return lines;
}

function personality(id) {
  return getData('rivals').personalities.find((p) => p.id === id);
}

function fillIntel(text, rival, label) {
  const m = rival.master;
  const s = findById('servants', rival.servant.id);
  const origin = findById('places', m.originPlaceId);
  const notes = getData('rivals').personalityNotes;
  return text
    .replaceAll('{label}', label)
    .replaceAll('{district}', m.district)
    .replaceAll('{description}', m.description)
    .replaceAll('{base}', m.base)
    .replaceAll('{name}', m.name)
    .replaceAll('{family}', findById('families', m.familyId).name)
    .replaceAll('{age}', String(m.age))
    .replaceAll('{origin}', origin.name)
    .replaceAll('{personalityNote}', notes[m.personalityId] || '')
    .replaceAll('{class}', s.class)
    .replaceAll('{trueName}', s.trueName);
}
