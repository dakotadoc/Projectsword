// The battle engine (no UI). battle.js shows it; this file decides what
// happens. Every function returns log lines ({ text, kind }) for the screen.
//
// Two sides, 'you' and 'enemy', each with a Servant (if they still have
// one) and a Master. Each round both sides pick a Servant action and a
// Master action; then everyone acts in speed order.
//
// Class rules, skills and Noble Phantasms come from data (classes.json and
// the "combat" fields in servants.json).
//
// state.battle = {
//   rivalId, trigger ('ambush'|'spotted'|'patrol'), location ('theirBase'|'street'),
//   round, step ('servant'|'master'|'over'), pending (your chosen Servant action),
//   effects: [{ side, stat, amount, rounds }],   // buffs and debuffs on Servants
//   dots: [{ side, amount, rounds }],             // damage over time on Servants
//   guard: { you, enemy },                         // rounds of full protection for the Master
//   stunned: { you, enemy }, npUsed: { you, enemy }, lastStand: { you, enemy },
//   defensePenalty: { you, enemy }, cooldowns: { you: {}, enemy: {} },
//   result: null | { outcome, ... }               // set when the battle ends
// }

import { getData, findById } from './data.js';
import { random, randInt, chance, pick } from './rng.js';
import { rankValue } from './ranks.js';
import { gainIntel, rivalLabel } from './intel.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const R = () => getData('rules').combat;
const T = () => getData('combat');
const other = (side) => (side === 'you' ? 'enemy' : 'you');

// ---- Setup ----

export function startBattle(state, rival, trigger) {
  ensureMasterHp(state);
  state.battle = {
    rivalId: rival.id,
    trigger,
    location: trigger === 'ambush' || trigger === 'betrayal' ? 'theirBase' : trigger === 'raid' ? 'yourBase' : 'street',
    final: trigger === 'final', // no retreat, no escape, fought to the end
    round: 1,
    step: 'servant',
    pending: null,
    effects: [],
    dots: [],
    guard: { you: 0, enemy: 0 },
    stunned: { you: false, enemy: false },
    npUsed: { you: false, enemy: false },
    lastStand: { you: 0, enemy: 0 },
    defensePenalty: { you: 0, enemy: 0 },
    cooldowns: { you: {}, enemy: {} },
    result: null,
  };
  const lines = [{ text: fill(pickText(T().start[trigger]), state), kind: 'narration' }];
  if (state.battle.location === 'theirBase' && rival.master.workshop) {
    lines.push({ text: T().atTheirBase.replace('{level}', rival.master.workshop), kind: 'system' });
  }
  if (state.battle.location === 'yourBase' && state.war?.workshop) {
    lines.push({ text: T().atYourBase.replace('{level}', state.war.workshop), kind: 'system' });
  }
  if (state.battle.final) lines.push({ text: T().finalRules, kind: 'system' });
  // Fighting someone teaches them who you are and roughly where you go.
  rival.knows ??= {};
  rival.knows.player = Math.max(rival.knows.player || 0, trigger === 'raid' ? 2 : 1);
  if (!hasServant(state)) lines.push({ text: T().noServantStart, kind: 'system' });
  return lines;
}

// The player's Master HP, from Body (added in milestone 8).
export function ensureMasterHp(state) {
  const m = state.master;
  const r = R().masterHp;
  const max = Math.round(r.base + r.perBody * m.stats.body);
  if (!m.hp) m.hp = { current: max, max };
  else if (m.hp.max !== max) {
    m.hp.current = Math.max(1, Math.round((m.hp.current / m.hp.max) * max));
    m.hp.max = max;
  }
}

export function hasServant(state) {
  return Boolean(state.servant) && state.servant.status !== 'lost';
}

export function battleRival(state) {
  return state.rivals.find((r) => r.id === state.battle.rivalId);
}

// ---- Unit helpers ----

// Everything about one side needed for the fight.
function sideOf(state, side) {
  const rival = battleRival(state);
  if (side === 'you') {
    const alive = hasServant(state) && state.servant.hp.current > 0;
    const data = alive ? findById('servants', state.servant.id) : null;
    return {
      side, rival,
      servant: alive ? { data, hp: state.servant.hp, cls: classOf(data), name: data.name } : null,
      master: { hp: state.master.hp, mana: state.master.mana, stats: state.master.stats, name: 'you', isPlayer: true },
      workshop: state.battle.location === 'yourBase' ? (state.war?.workshop || 0) : 0,
    };
  }
  const alive = rival.servant.hp.current > 0;
  const data = findById('servants', rival.servant.id);
  return {
    side, rival,
    servant: alive ? { data, hp: rival.servant.hp, cls: classOf(data), name: enemyServantName(rival) } : null,
    master: { hp: rival.master.hp, mana: rival.master.mana, stats: rival.master.stats, name: enemyMasterName(rival), isPlayer: false },
    workshop: state.battle.location === 'theirBase' ? rival.master.workshop : 0,
  };
}

function classOf(servant) {
  return getData('classes').find((c) => c.id === servant.class) || {};
}

// What the player calls the enemy right now (respects intel).
function enemyServantName(rival) {
  if (rival.intel.servant >= 3) return findById('servants', rival.servant.id).name;
  if (rival.intel.servant >= 1) return `the enemy ${findById('servants', rival.servant.id).class}`;
  return 'the enemy Servant';
}
function enemyMasterName(rival) {
  return rival.intel.master >= 2 ? rival.master.name : 'the enemy Master';
}

// Bond bonuses for the player's Servant (rules.bond.tiers): small attack
// and defense bonuses at 40/60/80, and at 80+ a chance to take a killing
// blow meant for the Master.
export function bondTier(state) {
  if (!hasServant(state)) return {};
  return [...getData('rules').bond.tiers].reverse().find((t) => state.servant.bond >= t.min) || {};
}

function effectTotal(state, side, stat) {
  return state.battle.effects.filter((e) => e.side === side && e.stat === stat).reduce((a, e) => a + e.amount, 0);
}

function npManaCost(servant) {
  const r = R().noblePhantasm;
  return r.manaBase + r.manaPerRank * rankValue(servant.noblePhantasm.rank);
}

// ---- What the player may do ----

export function servantOptions(state) {
  const you = sideOf(state, 'you');
  const b = state.battle;
  if (!you.servant) return [];
  const s = you.servant.data;
  const opts = [
    { type: 'attack', target: 'servant', label: 'Attack their Servant', hint: 'A straightforward strike' },
    { type: 'attack', target: 'master', label: 'Attack their Master', hint: 'Their Servant may get in the way' },
    { type: 'defend', label: 'Defend', hint: 'Take less damage and shield yourself' },
  ];
  s.skills.forEach((sk, i) => {
    const cd = b.cooldowns.you[i] || 0;
    const short = sk.description.split(/(?<=[.!?])\s/)[0];
    opts.push({ type: 'skill', index: i, label: sk.name, hint: cd ? `Ready in ${cd} round${cd > 1 ? 's' : ''}` : short, disabled: cd > 0 });
  });
  const np = s.noblePhantasm;
  const cost = npManaCost(s);
  const money = np.combat.moneyCost;
  const npOk = !b.npUsed.you && (money ? state.master.money >= money : state.master.mana.current >= cost);
  opts.push({
    type: 'np', label: `Noble Phantasm: ${np.name}`,
    hint: b.npUsed.you ? 'Already used this battle' : money ? `Costs ${money} money. Reveals your Servant's true name` : `Costs ${cost} mana. Reveals your Servant's true name`,
    disabled: !npOk,
  });
  if (!b.final) opts.push({ type: 'retreat', label: 'Retreat', hint: `About ${Math.round(retreatChance(state, 'you') * 100)}% chance` });
  return opts;
}

export function masterOptions(state) {
  const sp = R().masterSpell;
  const mana = state.master.mana.current;
  const serv = hasServant(state) && state.servant.hp.current > 0;
  const opts = [];
  if (serv) {
    opts.push({ type: 'support', label: 'Support spell', hint: `Strengthen your Servant. ${sp.support.mana} mana`, disabled: mana < sp.support.mana });
    opts.push({ type: 'heal', label: 'Heal your Servant', hint: `${sp.heal.mana} mana`, disabled: mana < sp.heal.mana });
  }
  opts.push({ type: 'bolt', target: 'master', label: 'Attack their Master', hint: `Magic or bare hands. ${sp.bolt.mana} mana`, disabled: mana < sp.bolt.mana });
  if (!serv) opts.push({ type: 'bolt', target: 'servant', label: 'Attack their Servant', hint: `Hopeless odds. ${sp.bolt.mana} mana`, disabled: mana < sp.bolt.mana });
  opts.push({ type: 'observe', label: 'Observe', hint: 'Study the enemy for intel' });
  if (serv && state.master.commandSeals > 0) {
    opts.push({ type: 'seal', label: `Use a Command Seal (${state.master.commandSeals} left)`, hint: 'Costs Bond' });
  }
  if (!serv && !state.battle.final) opts.push({ type: 'retreat', label: 'Run', hint: `About ${Math.round(retreatChance(state, 'you') * 100)}% chance` });
  opts.push({ type: 'none', label: serv ? 'Stay back' : 'Brace yourself', hint: 'Do nothing this round' });
  return opts;
}

export const SEAL_OPTIONS = [
  { kind: 'empower', label: 'Empower', hint: 'A burst of strength and some healing' },
  { kind: 'escape', label: 'Escape', hint: 'Teleport away. Always works' },
  { kind: 'order', label: 'Absolute Order', hint: 'Unleash the Noble Phantasm now, at no cost' },
];

export function retreatChance(state, side) {
  const r = R().retreat;
  const me = sideOf(state, side);
  const them = sideOf(state, other(side));
  if (!me.servant) {
    const mr = R().masterRetreat;
    const chase = them.servant ? rankValue(them.servant.data.stats.agility) * 0.05 + (them.servant.cls.chase || 0) : 0;
    return clamp(mr.base + mr.perBody * me.master.stats.body - chase, r.min, r.max);
  }
  const myAgi = rankValue(me.servant.data.stats.agility);
  const theirAgi = them.servant ? rankValue(them.servant.data.stats.agility) : 0;
  const chase = them.servant ? (them.servant.cls.chase || 0) : -0.3;
  return clamp(r.base + r.perAgility * (myAgi - theirAgi) + (me.servant.cls.retreat || 0) - chase, r.min, r.max);
}

// ---- Enemy decisions (rule-based, by personality and class) ----

function enemyChoice(state) {
  const b = state.battle;
  const me = sideOf(state, 'enemy');
  const them = sideOf(state, 'you');
  const m = me.rival.master;
  const aggr = m.aggression;
  const choice = { servant: null, master: { type: 'none' }, seal: null };
  if (!me.servant) {
    choice.master = { type: 'bolt', target: 'master' };
    return choice;
  }
  const hpFrac = me.servant.hp.current / me.servant.hp.max;
  const sp = R().masterSpell;

  // Flee with a Command Seal when nearly beaten (careful Masters only).
  if (!b.final && hpFrac < 0.15 && m.commandSeals > 0 && aggr < 50) {
    choice.seal = 'escape';
    return choice;
  }
  const s = me.servant.data;
  const npCost = npManaCost(s);
  const readySkills = s.skills.map((_, i) => i).filter((i) => !(b.cooldowns.enemy[i] > 0));
  const theirHpFrac = them.servant ? them.servant.hp.current / them.servant.hp.max : 0;

  if (!b.final && hpFrac < 0.25 && aggr < 60 && chance(0.6)) choice.servant = { type: 'retreat' };
  else if (!b.npUsed.enemy && m.mana.current >= npCost && (theirHpFrac < 0.6 || m.personalityId === 'reckless' || (b.round >= 3 && chance(0.35)))) choice.servant = { type: 'np' };
  else if (readySkills.length && chance(0.35)) choice.servant = { type: 'skill', index: pick(readySkills) };
  else if (m.hp.current / m.hp.max < 0.4 && chance(0.4)) choice.servant = { type: 'defend' };
  else {
    let goForMaster;
    if (!them.servant) goForMaster = true;
    else if (me.servant.cls.id === 'Assassin') goForMaster = chance(0.5);
    else if (m.personalityId === 'schemer') goForMaster = chance(0.25);
    else goForMaster = chance(aggr / 600);
    choice.servant = { type: 'attack', target: goForMaster ? 'master' : 'servant' };
  }

  if (hpFrac < 0.5 && m.mana.current >= sp.heal.mana && chance(0.6)) choice.master = { type: 'heal' };
  else if (aggr > 55 && m.mana.current >= sp.bolt.mana && chance(0.3)) choice.master = { type: 'bolt', target: 'master' };
  else if (m.mana.current >= sp.support.mana && chance(0.35)) choice.master = { type: 'support' };
  return choice;
}

// ---- A round ----

// you: { servant: option|null, master: option, seal?: kind }
// Returns log lines. When the battle ends, state.battle.result is set.
export function resolveRound(state, you) {
  const b = state.battle;
  const lines = [];
  const say = (text, kind = 'narration') => lines.push({ text, kind });
  const enemy = enemyChoice(state);

  // Command Seal escapes happen before anything else.
  if (you.master?.type === 'seal' && you.seal === 'escape') {
    useSeal(state, lines);
    say(fillServant(T().lines.sealEscape, state), 'narration');
    return endBattle(state, lines, { outcome: 'retreated' });
  }
  if (enemy.seal === 'escape') {
    battleRival(state).master.commandSeals -= 1;
    say(T().lines.enemySeal);
    return endBattle(state, lines, { outcome: 'enemyFled' });
  }

  // Retreats are attempted first. A failed retreat loses that unit's turn.
  const retreating = { you: you.servant?.type === 'retreat' || you.master?.type === 'retreat', enemy: enemy.servant?.type === 'retreat' };
  if (retreating.you) {
    if (chance(retreatChance(state, 'you'))) {
      say(T().lines.retreatOk);
      return endBattle(state, lines, { outcome: 'retreated' });
    }
    say(T().lines.retreatFail);
  }
  if (retreating.enemy) {
    if (chance(retreatChance(state, 'enemy'))) {
      say(fillRival(T().lines.enemyRetreat, state));
      return endBattle(state, lines, { outcome: 'enemyFled' });
    }
    say(fillRival(T().lines.enemyRetreatFail, state));
  }

  // Berserker sometimes ignores orders.
  const yourSide = sideOf(state, 'you');
  let yourServantAction = retreating.you ? null : you.servant;
  if (yourServantAction && yourSide.servant?.cls.disobeyChance && !['attack', 'np'].includes(yourServantAction.type) && chance(yourSide.servant.cls.disobeyChance)) {
    say(T().lines.disobey.replace('{actor}', yourSide.servant.name));
    yourServantAction = { type: 'attack', target: 'servant' };
  }

  // Build the turn order.
  const actors = [];
  const enemySide = sideOf(state, 'enemy');
  if (yourSide.servant && yourServantAction) actors.push({ side: 'you', unit: 'servant', action: yourServantAction, speed: servantSpeed(state, yourSide) });
  if (enemySide.servant && enemy.servant && !retreating.enemy) actors.push({ side: 'enemy', unit: 'servant', action: enemy.servant, speed: servantSpeed(state, enemySide) });
  if (you.master && you.master.type !== 'retreat') actors.push({ side: 'you', unit: 'master', action: you.master, seal: you.seal, speed: masterSpeed(yourSide) });
  if (enemy.master) actors.push({ side: 'enemy', unit: 'master', action: enemy.master, speed: masterSpeed(enemySide) });
  actors.sort((a, z) => z.speed - a.speed);

  // Defending and guarding count from the start of the round.
  const defending = {
    you: yourServantAction?.type === 'defend',
    enemy: enemy.servant?.type === 'defend' && !retreating.enemy,
  };
  b.defending = defending;
  for (const side of ['you', 'enemy']) {
    if (defending[side]) {
      const s = sideOf(state, side);
      if (s.servant) say(T().lines.defend.replace('{actor}', cap(s.servant.name)));
    }
  }

  for (const actor of actors) {
    const me = sideOf(state, actor.side);
    if (actor.unit === 'servant' && !me.servant) continue;
    if (me.master.hp.current <= 0) continue;
    if (actor.unit === 'servant' && b.stunned[actor.side]) {
      b.stunned[actor.side] = false;
      say(T().lines.stunned.replace('{actor}', cap(me.servant.name)));
      continue;
    }
    if (actor.unit === 'servant') servantAct(state, actor.side, actor.action, lines);
    else masterAct(state, actor.side, actor.action, actor.seal, lines);
    if (checkEnd(state)) break;
  }

  if (!checkEnd(state)) endOfRound(state, lines);
  b.defending = null;
  const ended = checkEnd(state);
  if (ended) return endBattle(state, lines, ended);
  b.round += 1;
  if (b.final && b.round > R().finalMaxRounds) {
    // The last night has to end with someone falling: the more battered one.
    const mine = hasServant(state) ? state.servant.hp.current / state.servant.hp.max : 0;
    const theirs = battleRival(state).servant.hp.current / battleRival(state).servant.hp.max;
    if (mine >= theirs) battleRival(state).servant.hp.current = 0;
    else if (hasServant(state)) state.servant.hp.current = 0;
    else state.master.hp.current = 0;
    return endBattle(state, lines, checkEnd(state));
  }
  if (!b.final && b.round > R().maxRounds) {
    say(T().lines.timeout);
    return endBattle(state, lines, { outcome: 'draw' });
  }
  return lines;
}

function servantSpeed(state, s) {
  return rankValue(s.servant.data.stats.agility) + (s.servant.cls.speed || 0) + effectTotal(state, s.side, 'speed') + random() * 2
    + (state.battle.round === 1 && s.servant.cls.firstStrikeAttack ? 10 : 0);
}
function masterSpeed(s) {
  return 1 + s.master.stats.body / 40 + random() * 1.5;
}

// ---- Servant actions ----

function servantAct(state, side, action, lines) {
  const me = sideOf(state, side);
  const say = (text, kind = 'narration') => lines.push({ text, kind });
  if (action.type === 'defend') return; // already applied
  if (action.type === 'attack') {
    servantAttack(state, side, action.target, 1, {}, lines);
  } else if (action.type === 'skill') {
    useSkill(state, side, action.index, lines);
  } else if (action.type === 'np') {
    useNoblePhantasm(state, side, lines, { free: false });
  } else if (action.type === 'retreat') {
    say(T().lines.noTarget.replace('{actor}', cap(me.servant.name)));
  }
}

// Damage multiplier for a Servant's attack.
function attackMultiplier(state, side) {
  const b = state.battle;
  const me = sideOf(state, side);
  const them = sideOf(state, other(side));
  const cls = me.servant.cls;
  let mult = 1 + (cls.attack || 0) + effectTotal(state, side, 'attack');
  if (cls.rangedRounds) {
    const enemyIsArcher = them.servant?.cls.id === 'Archer';
    if (!enemyIsArcher) mult += b.round <= cls.rangedRounds ? cls.rangedAttack : cls.closedAttack;
  }
  if (cls.firstStrikeAttack && b.round === 1) mult += cls.firstStrikeAttack;
  if (cls.workshopAttack && me.workshop) mult += cls.workshopAttack * me.workshop;
  if (b.lastStand[side]) mult += b.lastStand[side] * (1 - me.servant.hp.current / me.servant.hp.max);
  if (knowsName(state, side)) mult += R().weaknessBonus;
  if (side === 'you') mult += bondTier(state).attack || 0;
  return Math.max(0.2, mult);
}

// Whether `side` knows the other side's Servant's true name.
function knowsName(state, side) {
  const rival = battleRival(state);
  return side === 'you' ? rival.intel.servant >= 3 : rival.knowsPlayerServant;
}

// Damage reduction for a side's Servant (0..0.8).
function servantDefense(state, side, { ignoreDefend = false, ignoreWorkshop = false } = {}) {
  const b = state.battle;
  const s = sideOf(state, side);
  let red = R().endurancePerRank * rankValue(s.servant.data.stats.endurance) + (s.servant.cls.defense || 0) + effectTotal(state, side, 'defense') - b.defensePenalty[side];
  if (s.workshop && !ignoreWorkshop) red += R().workshopDefensePerLevel * s.workshop + (s.servant.cls.workshopDefense || 0) * s.workshop;
  if (b.guard[side] > 0) red += 0.25;
  if (side === 'you') red += bondTier(state).defense || 0;
  red = clamp(red, -0.5, 0.8);
  let mult = 1 - red;
  if (!ignoreDefend && b.defending?.[side]) mult *= R().defendReduction;
  return mult;
}

function servantAttack(state, side, target, power, opts, lines) {
  const me = sideOf(state, side);
  const them = sideOf(state, other(side));
  const r = R().attack;
  // Most classes hit with Strength; a Caster's attacks are spells, using Mana.
  const stat = me.servant.cls.attackStat || 'strength';
  let dmg = (r.base + r.perStrength * rankValue(me.servant.data.stats[stat]) + randInt(0, r.random)) * power * attackMultiplier(state, side);
  const crit = chance(R().critBase + R().critPerLuck * rankValue(me.servant.data.stats.luck));
  if (crit) dmg *= R().critMultiplier;
  const verb = pick(me.servant.cls.attackVerbs || ['attacks']);
  hit(state, side, target, dmg, { verb, crit, servantMagic: Boolean(me.servant.cls.magicAttack), ...opts }, lines);
  // Lancer: probing attacks can teach the player something.
  if (side === 'you' && me.servant.cls.probeIntelChance && chance(me.servant.cls.probeIntelChance)) {
    const text = gainIntel(state, battleRival(state), 'servant');
    if (text) lines.push({ text, kind: 'narration' }, { text: 'New intel.', kind: 'effect' });
  }
}

// Apply damage from `side` to the other side's servant or master.
// Attacks on a Master may be intercepted by their Servant.
function hit(state, side, target, rawDamage, opts, lines) {
  const b = state.battle;
  const me = sideOf(state, side);
  const them = sideOf(state, other(side));
  const attacker = opts.attackerName || cap(me.servant?.name || 'You');
  let tgt = target;
  if (tgt === 'servant' && !them.servant) tgt = 'master';
  if (tgt === 'master' && them.servant && !opts.noIntercept) {
    const sure = b.defending?.[other(side)] || b.guard[other(side)] > 0;
    const bypass = me.servant && opts.verb ? (me.servant.cls.masterStrike || 0) : 0;
    if (sure || chance(R().interceptChance * (1 - bypass))) {
      lines.push({ text: fillLine(T().lines.intercept, { defender: cap(them.servant.name), target: them.master.isPlayer ? 'you' : them.master.name }), kind: 'narration' });
      tgt = 'servant';
      rawDamage *= R().interceptDamage;
    }
  }
  let dmg = rawDamage;
  if (tgt === 'servant') {
    dmg *= servantDefense(state, other(side), opts);
    // Magic resistance: full against a Master's spells, half against a
    // Caster's (a Servant's spells are harder to shrug off).
    if (opts.magic) dmg *= 1 - (them.servant.cls.magicResist || 0);
    else if (opts.servantMagic) dmg *= 1 - 0.5 * (them.servant.cls.magicResist || 0);
  }
  dmg = Math.max(1, Math.round(dmg));
  // High Bond: the player's Servant may take a killing blow meant for them.
  if (tgt === 'master' && them.master.isPlayer && them.servant && dmg >= them.master.hp.current
      && chance(bondTier(state).shieldChance || 0)) {
    lines.push({ text: T().lines.bondShield.replace('{servant}', cap(them.servant.name)), kind: 'narration' });
    tgt = 'servant';
    dmg = Math.max(1, Math.round(dmg * servantDefense(state, other(side), opts)));
  }
  const hpRef = tgt === 'servant' ? them.servant.hp : them.master.hp;
  hpRef.current = Math.max(0, hpRef.current - dmg);
  const targetName = tgt === 'servant' ? them.servant.name : (them.master.isPlayer ? 'you' : them.master.name);
  const tpl = opts.template || T().lines.attack;
  lines.push({ text: fillLine(tpl, { attacker, actor: attacker, verb: opts.verb || 'hits', target: targetName, damage: dmg }), kind: 'narration' });
  if (opts.crit) lines.push({ text: T().lines.crit, kind: 'effect' });
  return dmg;
}

function useSkill(state, side, index, lines) {
  const b = state.battle;
  const me = sideOf(state, side);
  const skill = me.servant.data.skills[index];
  const c = skill.combat;
  b.cooldowns[side][index] = R().skillCooldown + 1; // +1: this round's tick
  lines.push({ text: `${cap(me.servant.name)} uses ${skill.name}.`, kind: 'system' });
  if (c.text) lines.push({ text: c.text.replaceAll('{name}', cap(me.servant.name)), kind: 'narration' });
  applyCombatEffect(state, side, c, lines);
}

// Shared by skills and Noble Phantasms.
function applyCombatEffect(state, side, c, lines) {
  const b = state.battle;
  const me = sideOf(state, side);
  const them = sideOf(state, other(side));
  const addEffect = (s, stat, amount, rounds) => { if (amount) b.effects.push({ side: s, stat, amount, rounds: rounds + 1 }); };
  switch (c.type) {
    case 'buff':
      for (const stat of ['attack', 'defense', 'speed']) addEffect(side, stat, c[stat], c.rounds);
      break;
    case 'weaken':
      addEffect(other(side), 'attack', c.attack, c.rounds);
      if (c.reveal && side === 'you') reveal(state, c.reveal, lines);
      break;
    case 'strike':
      servantAttack(state, side, 'servant', c.power, { ignoreDefend: c.ignoreDefend }, lines);
      break;
    case 'heal': {
      const amount = Math.round(me.servant.hp.max * c.amount);
      me.servant.hp.current = Math.min(me.servant.hp.max, me.servant.hp.current + amount);
      lines.push({ text: `+${amount} HP`, kind: 'effect' });
      break;
    }
    case 'gamble':
      if (chance(c.chance)) addEffect(side, 'attack', c.attack, c.rounds);
      else {
        addEffect(side, 'attack', c.fail, c.rounds);
        lines.push({ text: 'The blessing turns sour.', kind: 'effect' });
      }
      break;
    case 'guard':
      b.guard[side] = c.rounds + 1;
      addEffect(side, 'defense', c.defense, c.rounds);
      break;
    case 'reveal':
      if (side === 'you') reveal(state, c.track, lines);
      break;
    case 'stun':
      if (them.servant && chance(c.chance)) b.stunned[other(side)] = true;
      break;
    case 'dot':
      if (them.servant) b.dots.push({ side: other(side), amount: c.amount, rounds: c.rounds });
      break;
    case 'lastStand':
      b.lastStand[side] = c.attack;
      break;
    default:
      break;
  }
}

function reveal(state, track, lines) {
  const text = gainIntel(state, battleRival(state), track);
  if (text) lines.push({ text, kind: 'narration' }, { text: 'New intel.', kind: 'effect' });
}

function useNoblePhantasm(state, side, lines, { free }) {
  const b = state.battle;
  const me = sideOf(state, side);
  const np = me.servant.data.noblePhantasm;
  const c = np.combat;
  if (!free) {
    if (c.moneyCost && side === 'you') state.master.money = Math.max(0, state.master.money - c.moneyCost);
    else me.master.mana.current = Math.max(0, me.master.mana.current - npManaCost(me.servant.data));
  }
  b.npUsed[side] = true;
  // The NP reveals who the Servant is.
  if (side === 'you') battleRival(state).knowsPlayerServant = true;
  lines.push({ text: fillLine(T().lines.np, { actor: cap(me.servant.name), np: np.name }), kind: 'roll' });
  lines.push({ text: c.text.replaceAll('{name}', cap(me.servant.name)), kind: 'narration' });
  if (side === 'enemy') {
    const rival = battleRival(state);
    if (rival.intel.servant < 3) {
      rival.intel.servant = 3;
      lines.push({ text: fillLine(T().lines.npReveal, { actor: findById('servants', rival.servant.id).name }), kind: 'narration' });
      lines.push({ text: 'New intel: their true name.', kind: 'effect' });
    }
  }
  const r = R().noblePhantasm;
  const raw = (r.base + r.perRank * rankValue(np.rank) + randInt(0, r.random)) * (c.power || 1) * attackMultiplier(state, side);
  const them = sideOf(state, other(side));
  if (c.power) hit(state, side, 'servant', raw, { verb: 'hits', noIntercept: true, ignoreWorkshop: c.ignoreWorkshop }, lines);
  if (c.splashMaster && them.master.hp.current > 0) {
    hit(state, side, 'master', raw * c.splashMaster, { verb: 'catches', noIntercept: true }, lines);
  }
  if (c.stun && sideOf(state, other(side)).servant) b.stunned[other(side)] = true;
  if (c.dot) b.dots.push({ side: other(side), amount: c.dot, rounds: c.dotRounds || 3 });
  if (c.buff) for (const stat of ['attack', 'defense']) if (c.buff[stat]) b.effects.push({ side, stat, amount: c.buff[stat], rounds: c.buff.rounds + 1 });
  if (c.defensePenalty) b.defensePenalty[side] += c.defensePenalty;
  if (c.selfDamage) {
    const dmg = Math.round(me.servant.hp.max * c.selfDamage);
    me.servant.hp.current = Math.max(0, me.servant.hp.current - dmg);
    lines.push({ text: fillLine(T().lines.selfDamage, { actor: cap(me.servant.name), damage: dmg }), kind: 'narration' });
  }
}

// ---- Master actions ----

function masterAct(state, side, action, seal, lines) {
  const me = sideOf(state, side);
  const sp = R().masterSpell;
  const actor = side === 'you' ? 'You' : cap(me.master.name);
  const say = (text, kind = 'narration') => lines.push({ text, kind });
  // The player's own lines are written "You pour…", not "You pours…".
  const line = (key) => (side === 'you' && T().youLines?.[key]) || T().lines[key];
  const spend = (n) => {
    if (me.master.mana.current < n) {
      say(line('noMana').replace('{actor}', actor));
      return false;
    }
    me.master.mana.current -= n;
    return true;
  };
  switch (action.type) {
    case 'support':
      if (!me.servant || !spend(sp.support.mana)) return;
      state.battle.effects.push({ side, stat: 'attack', amount: sp.support.attack + sp.support.perMagecraft * me.master.stats.magecraft, rounds: sp.support.rounds + 1 });
      say(fillLine(line('support'), { actor, target: me.servant.name }));
      break;
    case 'heal': {
      if (!me.servant || !spend(sp.heal.mana)) return;
      const amount = Math.round(sp.heal.base + sp.heal.perMagecraft * me.master.stats.magecraft);
      me.servant.hp.current = Math.min(me.servant.hp.max, me.servant.hp.current + amount);
      say(fillLine(line('heal'), { actor, target: me.servant.name, amount }));
      break;
    }
    case 'bolt': {
      if (!spend(sp.bolt.mana)) return;
      const st = me.master.stats;
      const dmg = sp.bolt.base + sp.bolt.perMagecraft * st.magecraft + sp.bolt.perBody * st.body + randInt(0, sp.bolt.random);
      const magic = st.magecraft >= 15;
      hit(state, side, action.target || 'master', dmg, {
        attackerName: actor, magic, template: magic ? line('masterBolt') : line('masterPunch'),
      }, lines);
      break;
    }
    case 'observe': {
      if (side !== 'you') return;
      const o = R().observe;
      const rival = battleRival(state);
      const track = rival.intel.servant <= rival.intel.master ? 'servant' : 'master';
      const text = chance(o.base + o.perMind * state.master.stats.mind) ? gainIntel(state, rival, track) || gainIntel(state, rival, track === 'servant' ? 'master' : 'servant') : null;
      if (text) {
        say(line('observe').replace('{actor}', actor));
        say(text);
        say('New intel.', 'effect');
      } else {
        say(line('observeFail').replace('{actor}', actor));
      }
      break;
    }
    case 'seal':
      if (side !== 'you' || !me.servant) return;
      useSeal(state, lines);
      if (seal === 'empower') {
        const e = R().commandSeal.empower;
        state.battle.effects.push({ side, stat: 'attack', amount: e.attack, rounds: e.rounds + 1 });
        const heal = Math.round(me.servant.hp.max * e.heal);
        me.servant.hp.current = Math.min(me.servant.hp.max, me.servant.hp.current + heal);
        say(fillServant(T().lines.sealEmpower, state));
        say(`+${heal} HP`, 'effect');
      } else if (seal === 'order') {
        say(fillServant(T().lines.sealOrder, state));
        useNoblePhantasm(state, side, lines, { free: true });
      }
      break;
    default:
      break;
  }
}

function useSeal(state, lines) {
  const cs = R().commandSeal;
  state.master.commandSeals -= 1;
  state.battle.sealsUsed = (state.battle.sealsUsed || 0) + 1;
  if (hasServant(state)) {
    const before = state.servant.bond;
    state.servant.bond = Math.max(0, state.servant.bond - cs.bondCost);
    lines.push({ text: `Command Seals: ${state.master.commandSeals} left · Bond -${before - state.servant.bond} (${state.servant.bond})`, kind: 'effect' });
  }
}

// ---- End of round, end of battle ----

function endOfRound(state, lines) {
  const b = state.battle;
  for (const dot of b.dots) {
    const s = sideOf(state, dot.side);
    if (!s.servant) continue;
    const dmg = Math.max(1, Math.round(s.servant.hp.max * dot.amount));
    s.servant.hp.current = Math.max(0, s.servant.hp.current - dmg);
    lines.push({ text: fillLine(T().lines.dot, { target: cap(s.servant.name), damage: dmg }), kind: 'narration' });
    dot.rounds -= 1;
  }
  b.dots = b.dots.filter((d) => d.rounds > 0);
  b.effects.forEach((e) => { e.rounds -= 1; });
  b.effects = b.effects.filter((e) => e.rounds > 0);
  for (const side of ['you', 'enemy']) {
    if (b.guard[side] > 0) b.guard[side] -= 1;
    for (const k of Object.keys(b.cooldowns[side])) if (b.cooldowns[side][k] > 0) b.cooldowns[side][k] -= 1;
    // Berserkers drain their Master.
    const s = sideOf(state, side);
    if (s.servant?.cls.manaDrain) {
      const n = Math.min(s.master.mana.current, s.servant.cls.manaDrain);
      s.master.mana.current -= n;
      if (n && side === 'you') lines.push({ text: fillLine(T().lines.drain, { actor: cap(s.servant.name), amount: n }), kind: 'effect' });
    }
  }
}

// Returns an outcome if someone is down, else null.
function checkEnd(state) {
  const enemy = sideOf(state, 'enemy');
  if (state.master.hp.current <= 0) return { outcome: 'masterKilled' };
  if (enemy.master.hp.current <= 0) return { outcome: 'enemyMasterKilled' };
  const youDown = hasServant(state) && state.servant.hp.current <= 0;
  const enemyDown = battleRival(state).servant.hp.current <= 0;
  if (youDown || enemyDown) return { outcome: 'servantsDown', youDown, enemyDown };
  return null;
}

// Settle the battle: saving throws, eliminations, intel and Bond.
function endBattle(state, lines, result) {
  const b = state.battle;
  const rival = battleRival(state);
  const res = T().results;
  const say = (text, kind = 'narration') => lines.push({ text, kind });
  const final = { outcome: result.outcome, rivalId: rival.id };

  if (result.outcome === 'masterKilled') {
    say(res.masterKilled);
    final.outcome = 'masterKilled';
    b.result = final;
    b.step = 'over';
    return lines;
  }
  if (result.outcome === 'enemyMasterKilled') {
    say(res.enemyMasterKilled.replaceAll('{label}', cap(rivalLabel(rival))));
    eliminate(state, rival, 'masterKilled');
    final.outcome = 'won';
  }
  if (result.outcome === 'servantsDown') {
    if (result.enemyDown) {
      say(res.enemyServantDown.replace('{servant}', cap(sideOf(state, 'enemy').servant?.name || enemyServantName(rival))));
      if (!b.final && chance(escapeSave(findById('servants', rival.servant.id)))) {
        rival.servant.hp.current = 1;
        say(res.enemyServantEscaped);
        final.outcome = 'enemyFled';
      } else {
        say(res.enemyServantDestroyed.replaceAll('{label}', cap(rivalLabel(rival))));
        eliminate(state, rival, 'servantDestroyed');
        final.outcome = 'won';
      }
    }
    if (result.youDown) {
      const name = findById('servants', state.servant.id).name;
      if (!b.final && chance(escapeSave(findById('servants', state.servant.id)))) {
        state.servant.hp.current = 1;
        say(res.yourServantEscaped.replaceAll('{servant}', name));
        if (final.outcome !== 'won') final.outcome = 'lostRetreated';
      } else {
        say(res.yourServantLost.replaceAll('{servant}', name));
        state.servant.status = 'lost';
        state.servant.lostDay = state.war?.day ?? null;
        state.servant.hp.current = 0;
        final.outcome = 'servantLost';
      }
    }
  }

  // Surviving a battle teaches you about the enemy's Servant.
  if (final.outcome !== 'masterKilled' && rival.status === 'active') {
    const text = gainIntel(state, rival, 'servant');
    if (text) {
      say(text);
      say('New intel.', 'effect');
    }
  }
  if (final.outcome === 'won' && hasServant(state)) {
    const before = state.servant.bond;
    state.servant.bond = Math.min(100, state.servant.bond + R().victoryBond);
    say(res.victoryBond);
    say(`Bond +${state.servant.bond - before} (${state.servant.bond})`, 'effect');
  }
  // Too many Command Seals with too little Bond: the Servant may leave.
  const cs = R().commandSeal;
  if (hasServant(state) && state.master.commandSeals === 0 && b.sealsUsed && state.servant.bond < cs.desertBond && chance(cs.desertChance)) {
    say(res.servantDeserts.replaceAll('{servant}', findById('servants', state.servant.id).name));
    state.servant.status = 'lost';
    state.servant.lostDay = state.war?.day ?? null;
    state.servant.hp.current = 0;
    final.outcome = 'servantLost';
  }
  b.result = final;
  b.step = 'over';
  return lines;
}

function escapeSave(servant) {
  const e = R().escapeSave;
  return clamp(e.base + e.perAgility * rankValue(servant.stats.agility) + e.perLuck * rankValue(servant.stats.luck) + (e.class[servant.class] || 0), 0.05, 0.9);
}

function eliminate(state, rival, how) {
  rival.status = 'eliminated';
  rival.eliminated = { by: 'player', how, day: state.war?.day ?? null };
  rival.servant.hp.current = 0;
}

// Saving throw when fleeing to the Church after losing your Servant.
// Easier when the rival who beat you is not aggressive.
export function churchSave(state, rival) {
  const c = R().churchSave;
  const calm = 100 - (rival?.master.aggression ?? 50);
  return clamp(c.base + c.perCalm * calm + c.perBody * state.master.stats.body, 0.05, 0.95);
}

// ---- Text helpers ----

function pickText(list) {
  return pick(list).text;
}
function fill(text, state) {
  const rival = battleRival(state);
  return text
    .replaceAll('{label}', cap(rivalLabel(rival)))
    .replaceAll('{base}', rival.master.base);
}
function fillRival(text, state) {
  return text.replaceAll('{label}', cap(rivalLabel(battleRival(state))));
}
function fillServant(text, state) {
  return text.replaceAll('{servant}', findById('servants', state.servant.id).name);
}
function fillLine(text, vars) {
  return text.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}
function cap(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}
