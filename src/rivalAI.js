// Rival Master AI (milestone 9). Rule-based and readable on purpose.
//
// Every night, after the player's own action, each active rival picks one
// action by weighted rules (aggression, personality, health, class):
//   hunt    – go after someone they know about (a rival, or the player)
//   scout   – learn about someone
//   fortify – improve their workshop
//   ally    – pair up with another rival
//   hide    – recover
// Fights between rivals are resolved off-screen by autoBattle(). The player
// hears about them at dawn as news (state.war.news), with details only as
// far as their intel goes.
//
// What rivals know: rival.knows = { player: 0–2, r2: 0–2, … }
//   1 = can find them in the streets, 2 = knows their base (can raid it).
// Alliances between rivals: state.alliances = [[idA, idB], …].
// The player's ally (at most one): state.war.ally = rivalId | null.

import { siblingLine } from './family.js';
import { getData, findById } from './data.js';
import { chance, pick, shuffle, weightedPick, random } from './rng.js';
import { rankValue } from './ranks.js';
import { activeRivals } from './rivals.js';
import { gainIntel, gainRandomIntel, rivalLabel } from './intel.js';
import { fits, makeContext } from './events.js';

const AI = () => getData('rivals').ai;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function ensureRivalAI(state) {
  for (const r of state.rivals || []) r.knows ??= {};
  state.alliances ??= [];
  if (state.war) {
    state.war.ally ??= null;
    state.war.news ??= [];
  }
}

// How many Masters are still in the war, counting the player.
export function mastersRemaining(state) {
  return activeRivals(state).length + 1;
}

export function alliedWith(state, a, b) {
  if (a === 'player' || b === 'player') {
    const other = a === 'player' ? b : a;
    return state.war?.ally === other;
  }
  return state.alliances.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
}

// ---- The night ----

// Run every rival's action for tonight. `playerAtHome`: the player stayed
// hidden in their base. Returns the rival raiding the player's base, or null.
// News for the player is queued in state.war.news for the next dawn.
export function rivalsAct(state, { playerAtHome, playerFought }) {
  ensureRivalAI(state);
  const ai = AI();
  const fought = new Set();
  let raid = null;

  // Alliances fall apart now and then, and all of them once few remain.
  breakAlliances(state);
  // A scheming ally may turn on the player.
  const ally = state.war.ally && state.rivals.find((r) => r.id === state.war.ally);
  if (ally && ally.status === 'active' && ally.master.personalityId === 'schemer' && chance(ai.schemerBetrayChance)) {
    state.war.ally = null;
    ally.betrayingPlayer = true;
    news(state, 'allyBetrays', { ally: rivalLabel(ally) });
    state.war.pendingRemark = 'betrayed';
  }

  for (const rival of shuffle(activeRivals(state))) {
    if (rival.status !== 'active' || fought.has(rival.id)) continue;
    const action = chooseAction(state, rival);
    if (action === 'hunt') {
      const target = huntTarget(state, rival);
      if (!target) continue;
      if (target === 'player') {
        if (playerFought) continue;
        if (playerAtHome && !raid) {
          raid = rival;
          fought.add(rival.id);
        } else if (!playerAtHome && rival.knows.player >= 2) {
          // They find the base empty and wreck what they can.
          if (state.war.workshop > 0) state.war.workshop -= 1;
          news(state, 'ransacked', {});
        }
        continue;
      }
      if (fought.has(target.id)) continue;
      fought.add(rival.id);
      fought.add(target.id);
      autoBattle(state, rival, target, { defenderAtHome: rival.knows[target.id] >= 2 });
    } else if (action === 'scout') {
      scoutSomeone(state, rival);
    } else if (action === 'fortify') {
      rival.master.workshop = Math.min(3, rival.master.workshop + 1);
    } else if (action === 'ally') {
      formAlliance(state, rival);
    } else {
      const heal = (ref) => { ref.current = Math.min(ref.max, ref.current + Math.round(ref.max * ai.hideRegen)); };
      heal(rival.servant.hp);
      heal(rival.master.hp);
    }
  }
  return raid;
}

function chooseAction(state, rival) {
  const ai = AI();
  const m = rival.master;
  const cls = findById('servants', rival.servant.id).class;
  const bias = ai.classBias[cls] || {};
  const a = m.aggression / 100;
  const hurt = rival.servant.hp.current / rival.servant.hp.max < ai.lowHp;
  const canHunt = rival.betrayingPlayer || Boolean(huntTarget(state, rival, { dryRun: true }));
  const hasAlly = state.alliances.some((p) => p.includes(rival.id)) || state.war.ally === rival.id;
  const w = {
    hunt: canHunt ? ai.weights.hunt * a * (hurt ? ai.lowHpHuntFactor : 1) + (bias.hunt || 0) : 0,
    scout: ai.weights.scout + (bias.scout || 0),
    fortify: m.workshop < 3 ? ai.weights.fortify * (1 - a) + (bias.fortify || 0) : 0,
    hide: ai.weights.hide + (hurt ? ai.lowHpHide : 0) + (bias.hide || 0),
    ally: hasAlly ? 0 : ai.weights.ally * (ai.allyWillingness[m.personalityId] || 0.5),
  };
  if (rival.betrayingPlayer) return 'hunt';
  const options = Object.entries(w).map(([id, weight]) => ({ id, weight: Math.max(0, weight) }));
  return weightedPick(options).id;
}

// Someone this rival knows about and isn't allied with.
function huntTarget(state, rival, { dryRun = false } = {}) {
  if (rival.betrayingPlayer && !dryRun) {
    rival.betrayingPlayer = false;
    rival.knows.player = 2;
    return 'player';
  }
  const options = [];
  for (const other of activeRivals(state)) {
    if (other.id === rival.id || alliedWith(state, rival.id, other.id)) continue;
    if ((rival.knows[other.id] || 0) >= 1) options.push(other);
  }
  if ((rival.knows.player || 0) >= 1 && !alliedWith(state, rival.id, 'player')) options.push('player');
  if (!options.length) return null;
  if (dryRun) return options[0];
  // Rivals are a little less likely to pick the player than each other.
  return weightedPick(options.map((o) => ({ o, weight: o === 'player' ? AI().playerTargetWeight : 1 }))).o;
}

function scoutSomeone(state, rival) {
  const ai = AI();
  const candidates = [
    ...activeRivals(state).filter((o) => o.id !== rival.id && (rival.knows[o.id] || 0) < 2).map((o) => o.id),
    ...((rival.knows.player || 0) < 2 ? ['player'] : []),
  ];
  if (!candidates.length) return;
  const target = pick(candidates);
  // The player's base is harder to find the better it is warded.
  if (target === 'player' && !chance(Math.max(0.1, ai.scoutPlayer.base - ai.scoutPlayer.perWorkshop * (state.war.workshop || 0)))) return;
  rival.knows[target] = (rival.knows[target] || 0) + 1;
  // The player may notice being watched, and learn something in return.
  if (target === 'player' && chance(ai.playerNoticeScout.base + ai.playerNoticeScout.perMind * state.master.stats.mind)) {
    news(state, 'watched', {});
    const text = gainIntel(state, rival, 'master', { max: 1 });
    if (text) state.war.news.push({ text, kind: 'narration' }, { text: 'New intel. See the Status tab.', kind: 'effect' });
  }
}

function formAlliance(state, rival) {
  const ai = AI();
  const partners = activeRivals(state).filter((o) => o.id !== rival.id
    && !state.alliances.some((p) => p.includes(o.id)) && state.war.ally !== o.id
    && chance(ai.allyWillingness[o.master.personalityId] || 0.5));
  if (!partners.length) return;
  const partner = pick(partners);
  state.alliances.push([rival.id, partner.id]);
  rival.knows[partner.id] = 2;
  partner.knows[rival.id] = 2;
  news(state, 'alliance', {});
}

function breakAlliances(state) {
  const ai = AI();
  const active = activeRivals(state);
  const ids = new Set(active.map((r) => r.id));
  state.alliances = state.alliances.filter(([a, b]) => ids.has(a) && ids.has(b)
    && active.length > ai.alliancesEndAtActive && !chance(ai.allianceBreakChance));
  if (state.war.ally) {
    const ally = state.rivals.find((r) => r.id === state.war.ally);
    if (!ally || ally.status !== 'active') {
      state.war.ally = null;
    } else if (active.length <= ai.alliancesEndAtActive - 1 && chance(0.5)) {
      state.war.ally = null;
      news(state, 'allianceEnds', { ally: rivalLabel(ally) });
    }
  }
}

// ---- Off-screen battles ----

// A simplified fight between two rivals, using the same stats as real
// combat. The loser's Servant may escape (unless `final`); otherwise that
// rival is out. Returns the winner (or null for a standoff).
export function autoBattle(state, a, b, { defenderAtHome = false, final = false } = {}) {
  const ai = AI();
  const combat = getData('rules').combat;
  const power = (r, other, home) => {
    const s = findById('servants', r.servant.id);
    const cls = getData('classes').find((c) => c.id === s.class) || {};
    const stat = rankValue(s.stats[cls.attackStat || 'strength']);
    const otherS = findById('servants', other.servant.id);
    const otherCls = getData('classes').find((c) => c.id === otherS.class) || {};
    const def = combat.endurancePerRank * rankValue(otherS.stats.endurance) + (otherCls.defense || 0)
      + (home === other ? combat.workshopDefensePerLevel * other.master.workshop + (otherCls.workshopDefense || 0) * other.master.workshop : 0);
    const atk = 1 + (cls.attack || 0) + (home === r && cls.workshopAttack ? cls.workshopAttack * r.master.workshop : 0);
    return (combat.attack.base + combat.attack.perStrength * stat) * atk * (1 - clamp(def, 0, 0.8));
  };
  const home = defenderAtHome ? b : null;
  for (let round = 0; round < (final ? 50 : ai.battleRounds); round++) {
    b.servant.hp.current = Math.max(0, b.servant.hp.current - Math.round(power(a, b, home) * (0.8 + random() * 0.4)));
    if (b.servant.hp.current <= 0) break;
    a.servant.hp.current = Math.max(0, a.servant.hp.current - Math.round(power(b, a, home) * (0.8 + random() * 0.4)));
    if (a.servant.hp.current <= 0) break;
  }
  let winner = null;
  let loser = null;
  if (a.servant.hp.current <= 0) { winner = b; loser = a; } else if (b.servant.hp.current <= 0) { winner = a; loser = b; }
  // Sometimes it's the Master who falls.
  if (!loser && !final && chance(ai.masterKillChance)) {
    loser = chance(0.5) ? a : b;
    winner = loser === a ? b : a;
    loser.master.hp.current = 0;
  }
  if (final && !loser) {
    // On the last night someone has to fall: the more battered one.
    loser = a.servant.hp.current / a.servant.hp.max < b.servant.hp.current / b.servant.hp.max ? a : b;
    winner = loser === a ? b : a;
  }

  const district = (defenderAtHome ? b : pick([a, b])).master.district;
  const who = describePair(state, a, b);
  news(state, 'clash', { district, detail: pickText(state, who ? 'clashDetailKnown' : 'clashDetailUnknown', { who }) });

  if (loser) {
    const s = findById('servants', loser.servant.id);
    const e = combat.escapeSave;
    const escapes = !final && loser.master.hp.current > 0
      && chance(clamp(e.base + e.perAgility * rankValue(s.stats.agility) + e.perLuck * rankValue(s.stats.luck) + (e.class[s.class] || 0), 0.05, 0.9));
    if (escapes) {
      loser.servant.hp.current = 1;
    } else {
      loser.status = 'eliminated';
      loser.servant.hp.current = 0;
      loser.eliminated = {
        by: winner.id, day: state.war.day,
        knownToPlayer: loser.intel.master >= 1 || loser.intel.servant >= 1,
      };
      news(state, 'eliminated', { remaining: mastersRemaining(state) });
      if (loser.eliminated.knownToPlayer) news(state, 'eliminatedKnown', { who: rivalLabel(loser) });
      if (loser.sibling) state.war.news.push({ text: siblingLine(state, 'eliminated'), kind: 'narration' });
    }
  }
  // Whoever fought learns where the other lives.
  a.knows[b.id] = 2;
  b.knows[a.id] = 2;
  return winner;
}

// "the Lancer and an unknown Servant", from the player's intel; '' if nothing known.
function describePair(state, a, b) {
  const known = [a, b].filter((r) => r.intel.servant >= 1).map((r) => `the ${findById('servants', r.servant.id).class}`);
  if (!known.length) return '';
  return known.length === 2 ? `${known[0]} and ${known[1]}` : `${known[0]} and another Servant`;
}

// ---- The last night ----

// More than one rival left at the end: they fight it out until one remains.
// Returns the last rival (or null if none survive).
export function finalShowdown(state) {
  let remaining = activeRivals(state);
  let guard = 0;
  while (remaining.length > 1 && guard++ < 20) {
    const [a, b] = shuffle(remaining);
    autoBattle(state, a, b, { final: true });
    remaining = activeRivals(state);
  }
  return remaining[0] || null;
}

// ---- Player alliances ----

export function allianceChance(state, rival) {
  const r = getData('rules').alliance;
  return clamp(r.base + r.perCharisma * state.master.stats.charisma + r.perAggression * rival.master.aggression
    + (r.personality[rival.master.personalityId] || 0), 0.05, 0.9);
}

export function proposeAlliance(state, rival) {
  ensureRivalAI(state);
  const ok = chance(allianceChance(state, rival));
  if (ok) {
    state.war.ally = rival.id;
    rival.knows.player = 2;
    state.alliances = state.alliances.filter((p) => !p.includes(rival.id));
  }
  return ok;
}

// Ally shares something at dawn now and then.
export function allyShares(state) {
  if (!state.war.ally) return null;
  const ally = state.rivals.find((r) => r.id === state.war.ally);
  if (!ally || ally.status !== 'active' || !chance(getData('rules').alliance.allyIntelChance)) return null;
  // Intel about someone other than the ally.
  const text = gainRandomIntel(state, { max: 2, exclude: [ally.id] });
  return text ? { ally, text } : null;
}

// ---- News ----

function news(state, key, vars) {
  state.war.news.push({ text: pickText(state, key, vars), kind: 'narration' });
}

function pickText(state, key, vars) {
  const ctx = makeContext(state, { age: state.master.warAge, year: state.world.warYear, day: state.war.day });
  const list = getData('rivals').news[key].filter((t) => fits(t, ctx));
  let text = pick(list).text;
  for (const [k, v] of Object.entries(vars)) text = text.replaceAll(`{${k}}`, String(v));
  return text.charAt(0).toUpperCase() + text.slice(1);
}
