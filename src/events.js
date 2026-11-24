// Random event engine, plus the condition / effect / text helpers that all
// data-driven content shares.
//
// A data entry (event, text variant, choice…) may restrict when it appears:
//   "from"/"to"         in-game years (see period.js)
//   "minAge"/"maxAge"   the Master's age
//   "minDay"/"maxDay"   the war day (war events)
//   "conditions": { isMage, places, families, traits, sex, minMoney, minContacts, hasServant,
//                   servants, minBond, maxBond, path, seen, notSeen }
//     servants: only with these Servants; minBond/maxBond/path: the player's
//     Bond and relationship path; seen/notSeen: event ids (for event chains).
//
// A choice may be a skill check instead of a fixed result:
//   { "label", "check": { "stat": "body", "difficulty": 40 },
//     "success": { "text", "effects" }, "failure": { "text", "effects" } }
// and may say what it shows about the Master: "shows": ["courage", …].
// The Servant approves of choices that show what they value, and disapproves
// of what they scorn (servants.json "values"/"scorns"), changing Bond.
//
// Effects look like:
//   { "stats": { "body": 2 }, "money": -50, "contacts": 1, "catalyst": true,
//     "bond": 1, "servantHp": -5, "mana": -10, "intel": 1 }
// "intel": n learns n new things about rivals (up to level 2). The reveal
// texts come back on the returned array as `.intel`, to be logged as story.

import { getData, findById } from './data.js';
import { weightedPick, chance } from './rng.js';
import { fitsYear } from './period.js';
import { findCatalyst } from './catalysts.js';
import { gainRandomIntel } from './intel.js';

export const STAT_NAMES = { body: 'Body', magecraft: 'Magecraft', mind: 'Mind', charisma: 'Charisma' };
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// Facts about the current moment that conditions are checked against.
export function makeContext(state, { age, year, day = null }) {
  const family = findById('families', state.master.familyId);
  return {
    age,
    year,
    day,
    hasServant: Boolean(state.servant) && state.servant.status !== 'lost',
    servantName: state.servant ? findById('servants', state.servant.id).name : '',
    contacts: state.master.contacts,
    placeId: state.world.placeId,
    placeName: findById('places', state.world.placeId).name,
    familyId: family.id,
    isMage: family.isMage,
    traitId: state.master.traitId,
    sex: state.master.sex,
    money: state.master.money,
    servantId: state.servant && state.servant.status !== 'lost' ? state.servant.id : null,
    bond: state.servant?.bond ?? 0,
    path: state.servant?.path ?? null,
    seen: [...(state.life?.seenEvents || []), ...(state.war?.seenEvents || [])],
  };
}

export function fits(entry, ctx) {
  if (!fitsYear(entry, ctx.year)) return false;
  if (Number.isFinite(entry.minAge) && ctx.age < entry.minAge) return false;
  if (Number.isFinite(entry.maxAge) && ctx.age > entry.maxAge) return false;
  if (Number.isFinite(entry.minDay) && !(ctx.day >= entry.minDay)) return false;
  if (Number.isFinite(entry.maxDay) && !(ctx.day <= entry.maxDay)) return false;
  const c = entry.conditions;
  if (!c) return true;
  if (typeof c.isMage === 'boolean' && c.isMage !== ctx.isMage) return false;
  if (c.places && !c.places.includes(ctx.placeId)) return false;
  if (c.families && !c.families.includes(ctx.familyId)) return false;
  if (c.traits && !c.traits.includes(ctx.traitId)) return false;
  if (c.sex && c.sex !== ctx.sex) return false;
  if (Number.isFinite(c.minMoney) && ctx.money < c.minMoney) return false;
  if (Number.isFinite(c.minContacts) && ctx.contacts < c.minContacts) return false;
  if (typeof c.hasServant === 'boolean' && c.hasServant !== Boolean(ctx.hasServant)) return false;
  if (c.servants && !c.servants.includes(ctx.servantId)) return false;
  if (Number.isFinite(c.minBond) && !(ctx.servantId && ctx.bond >= c.minBond)) return false;
  if (Number.isFinite(c.maxBond) && ctx.bond > c.maxBond) return false;
  if (c.path && c.path !== ctx.path) return false;
  if (c.seen && !c.seen.every((id) => ctx.seen?.includes(id))) return false;
  if (c.notSeen && c.notSeen.some((id) => ctx.seen?.includes(id))) return false;
  return true;
}

// Pick one fitting text variant from a list of { text, ...restrictions }.
// With `used` (an array kept in state), lines already shown this run are
// avoided while fresh ones remain, and the chosen line is recorded.
export function pickText(variants, ctx, used = null) {
  const ok = variants.filter((v) => fits(v, ctx));
  if (!ok.length) return null;
  const fresh = used ? ok.filter((v) => !used.includes(v.text)) : ok;
  const chosen = weightedPick(fresh.length ? fresh : ok);
  if (used) {
    used.push(chosen.text);
    if (used.length > 400) used.splice(0, used.length - 400);
  }
  return fillText(chosen.text, ctx);
}

// ---- Choices: skill checks and the Servant's values ----

export function checkChance(state, check) {
  const r = getData('rules').checks;
  const stat = state.master.stats[check.stat] ?? 0;
  return clamp(r.base + (stat - check.difficulty) * r.perPoint, r.min, r.max);
}

// The hint shown on a choice button.
export function choiceHint(state, choice) {
  if (!choice.check) return choice.hint || '';
  return `${STAT_NAMES[choice.check.stat]} check, about ${Math.round(checkChance(state, choice.check) * 100)}%`;
}

// Resolve a chosen option. Returns { texts: [...story lines], lines: effect
// lines (with .intel) } and applies everything to state.
export function resolveChoice(state, choice, ctx) {
  let outcome = choice;
  const texts = [];
  if (choice.check) {
    const ok = chance(checkChance(state, choice.check));
    outcome = ok ? choice.success : choice.failure;
    texts.push({ text: ok ? 'Success.' : 'Failure.', kind: 'effect' });
  }
  if (outcome.text) texts.push({ text: fillText(outcome.text, ctx), kind: 'narration' });
  const lines = applyEffects(state, outcome.effects, ctx);
  const reaction = servantReaction(state, choice.shows);
  if (reaction) {
    const before = state.servant.bond;
    state.servant.bond = clamp(state.servant.bond + reaction.delta, 0, 100);
    const name = findById('servants', state.servant.id).name;
    lines.push(`${name} ${reaction.delta > 0 ? 'approves' : 'disapproves'} · Bond ${signed(state.servant.bond - before)} (${state.servant.bond})`);
  }
  return { texts, lines };
}

// How the Servant feels about what a choice shows about the Master.
function servantReaction(state, shows) {
  if (!shows?.length || !state.servant || state.servant.status === 'lost') return null;
  const s = findById('servants', state.servant.id);
  const step = getData('rules').checks.valueBond;
  let delta = 0;
  for (const v of shows) {
    if (s.values?.includes(v)) delta += step;
    if (s.scorns?.includes(v)) delta -= step;
  }
  return delta ? { delta: clamp(delta, -step * 2, step * 2) } : null;
}

// Replace {place}, {year}, {age}, {servant} in data text.
export function fillText(text, ctx) {
  return text
    .replaceAll('{servant}', ctx.servantName || 'your Servant')
    .replaceAll('{place}', ctx.placeName)
    .replaceAll('{year}', String(ctx.year))
    .replaceAll('{age}', String(ctx.age));
}

// Roll one event for this phase that fits the moment and hasn't been seen
// (events marked "repeatable" may come up again).
export function rollEvent(phase, ctx, seenIds, excludeIds = []) {
  const pool = getData('events').filter(
    (e) => e.phase === phase && (e.repeatable || !seenIds.includes(e.id)) && !excludeIds.includes(e.id) && fits(e, ctx),
  );
  return pool.length ? weightedPick(pool) : null;
}

// Apply effects to state.master. Returns readable lines, e.g. "Body +3 (24)".
export function applyEffects(state, effects, ctx) {
  const m = state.master;
  const lines = [];
  lines.intel = [];
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
  if (effects.mana) {
    const before = m.mana.current;
    m.mana.current = clamp(m.mana.current + effects.mana, 0, m.mana.max);
    if (m.mana.current !== before) lines.push(`Mana ${signed(m.mana.current - before)} (${m.mana.current}/${m.mana.max})`);
  }
  // Servant effects do nothing once the Servant is gone.
  const sv = state.servant && state.servant.status !== 'lost' ? state.servant : null;
  if (effects.bond && sv) {
    const before = sv.bond;
    sv.bond = clamp(sv.bond + effects.bond, 0, 100);
    if (sv.bond !== before) lines.push(`Bond ${signed(sv.bond - before)} (${sv.bond})`);
  }
  if (effects.servantHp && sv) {
    const before = sv.hp.current;
    sv.hp.current = clamp(sv.hp.current + effects.servantHp, 1, sv.hp.max);
    const name = findById('servants', sv.id).name;
    if (sv.hp.current !== before) lines.push(`${name} HP ${signed(sv.hp.current - before)} (${sv.hp.current}/${sv.hp.max})`);
  }
  if (effects.masterHp && m.hp) {
    const before = m.hp.current;
    m.hp.current = clamp(m.hp.current + effects.masterHp, 1, m.hp.max);
    if (m.hp.current !== before) lines.push(`Your HP ${signed(m.hp.current - before)} (${m.hp.current}/${m.hp.max})`);
  }
  if (effects.catalyst) {
    const found = findCatalyst(state, ctx);
    if (found) lines.push(`Catalyst found: ${found.name}`);
  }
  lines.intel = [];
  for (let i = 0; i < (effects.intel || 0) && state.rivals; i++) {
    const text = gainRandomIntel(state, { max: 2 });
    if (text) lines.intel.push(text);
  }
  return lines;
}

export function signed(n) {
  return n > 0 ? `+${n}` : `${n}`;
}
