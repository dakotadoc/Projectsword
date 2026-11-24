// Loads the content files in /data once at startup and checks them, so a
// typo in a JSON file shows a clear message instead of breaking mid-game.
//
// Use getData('places') etc. after loadData() has finished, and
// findById('places', id) to look up something a save refers to.

import { RANKS, STAT_LABELS } from './ranks.js';
import { availableIn } from './period.js';

const FILES = ['rules', 'places', 'eras', 'families', 'traits', 'life', 'events', 'catalysts', 'servants', 'summon', 'dialogue', 'war', 'rivals', 'classes', 'combat'];
const STATS = ['body', 'magecraft', 'mind', 'charisma'];
const CONDITION_KEYS = ['isMage', 'places', 'families', 'traits', 'sex', 'minMoney', 'minContacts', 'hasServant'];
const EFFECT_KEYS = ['stats', 'money', 'contacts', 'catalyst', 'relicChance', 'bond', 'servantHp', 'mana', 'intel', 'masterHp'];

const data = {};

export async function loadData() {
  await Promise.all(FILES.map(async (name) => {
    const url = new URL(`../data/${name}.json`, import.meta.url);
    let res;
    try {
      res = await fetch(url);
    } catch {
      throw new Error(`Couldn't load data/${name}.json.`);
    }
    if (!res.ok) throw new Error(`Couldn't load data/${name}.json (${res.status}).`);
    try {
      data[name] = await res.json();
    } catch {
      throw new Error(`data/${name}.json isn't valid JSON. Check for a missing comma or quote.`);
    }
  }));
  validate();
}

export function getData(name) {
  if (!(name in data)) throw new Error(`Data "${name}" isn't loaded.`);
  return data[name];
}

export function findById(name, id) {
  const item = getData(name).find((entry) => entry.id === id);
  if (!item) throw new Error(`No entry "${id}" in data/${name}.json.`);
  return item;
}

// ---- Checks ----

function validate() {
  const problems = [];
  const need = (cond, msg) => { if (!cond) problems.push(msg); };
  const isRange = (r) => Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[0] <= r[1];

  const r = data.rules;
  need(Number.isFinite(r.lifeStartAge), 'rules.lifeStartAge must be a number');
  need(isRange(r.warAge), 'rules.warAge must be [min, max]');
  need(Number.isFinite(r.manaPerCircuitRank), 'rules.manaPerCircuitRank must be a number');

  const lists = {
    places: ['name', 'country', 'birthText', 'description'],
    eras: ['name', 'description'],
    families: ['name', 'birthText', 'description'],
    traits: ['name', 'description'],
    events: ['phase', 'text'],
    catalysts: ['name', 'description', 'findText'],
    servants: ['trueName', 'class', 'title', 'sex', 'origin', 'appearance', 'weakness', 'summonText', 'firstLine'],
  };
  for (const [file, fields] of Object.entries(lists)) {
    const list = data[file];
    if (!Array.isArray(list) || list.length === 0) {
      problems.push(`${file}.json must be a non-empty list`);
      continue;
    }
    const seen = new Set();
    list.forEach((entry, i) => {
      const where = `${file}.json entry ${entry.id || `#${i + 1}`}`;
      need(typeof entry.id === 'string' && entry.id, `${where}: missing "id"`);
      need(!seen.has(entry.id), `${where}: duplicate id`);
      seen.add(entry.id);
      for (const f of fields) need(typeof entry[f] === 'string' && entry[f], `${where}: missing "${f}"`);
      need(entry.weight === undefined || Number.isFinite(entry.weight), `${where}: "weight" must be a number`);
      checkYears(entry, where);
    });
  }

  // Every year a character could be born in must have names for both sexes.
  const birthYears = [
    Math.min(...data.eras.map((e) => e.warYears?.[0])) - r.warAge?.[1],
    Math.max(...data.eras.map((e) => e.warYears?.[1])) - r.warAge?.[0],
  ];
  for (const p of data.places) {
    need(Array.isArray(p.familyNames) && p.familyNames.length, `places.json ${p.id}: needs familyNames`);
    (p.familyNames || []).forEach((n, i) => need(
      typeof n === 'string' || (typeof n?.male === 'string' && typeof n?.female === 'string'),
      `places.json ${p.id} familyNames #${i + 1}: must be "Name" or { "male": ..., "female": ... }`,
    ));
    for (const sex of ['male', 'female']) {
      const names = p.givenNames?.[sex];
      if (!Array.isArray(names) || !names.length) {
        problems.push(`places.json ${p.id}: needs givenNames.${sex}`);
        continue;
      }
      names.forEach((n, i) => {
        const where = `places.json ${p.id} givenNames.${sex} #${i + 1}`;
        need(typeof n === 'string' || (typeof n?.name === 'string' && n.name), `${where}: must be "Name" or { "name": ... }`);
        checkYears(n, where);
      });
      const gaps = [];
      for (let y = birthYears[0]; y <= birthYears[1]; y++) {
        if (!availableIn(names, y).length) gaps.push(y);
      }
      need(!gaps.length, `places.json ${p.id}: no ${sex} names for birth years ${gaps[0]}–${gaps[gaps.length - 1]}`);
    }
  }
  for (const e of data.eras) need(isRange(e.warYears), `eras.json ${e.id}: warYears must be [first, last]`);
  for (const f of data.families) {
    for (const s of ['body', 'magecraft', 'mind', 'charisma']) {
      need(isRange(f.stats?.[s]), `families.json ${f.id}: stats.${s} must be [min, max]`);
    }
    need(isRange(f.money), `families.json ${f.id}: money must be [min, max]`);
    need(isRange(f.contacts), `families.json ${f.id}: contacts must be [min, max]`);
    const w = f.circuitWeights || {};
    need(Object.keys(w).every((k) => RANKS.includes(k)), `families.json ${f.id}: circuitWeights keys must be E, D, C, B, A, EX`);
    need(Object.values(w).some((v) => v > 0), `families.json ${f.id}: circuitWeights needs a weight above 0`);
  }

  for (const r2 of ['lifeTurns', 'lifeGainPerYear']) need(isRange(r[r2]), `rules.${r2} must be [min, max]`);
  for (const k of ['socializeContactChance', 'relicSearch']) need(r[k] && typeof r[k] === 'object', `rules.${k} is missing`);
  need(RANKS.every((k) => Number.isFinite(r.magecraftQualityMultiplier?.[k])), 'rules.magecraftQualityMultiplier needs E, D, C, B, A, EX');

  for (const t of data.traits) checkEffects(t.effects, `traits.json ${t.id}`);

  // life.json: action and text lists
  const life = data.life || {};
  for (const key of ['intro', 'quietYear', 'warAnnouncement']) checkTexts(life[key], `life.json ${key}`);
  need(Array.isArray(life.actions) && life.actions.length, 'life.json: needs actions');
  for (const a of life.actions || []) {
    const where = `life.json action ${a.id || '?'}`;
    need(typeof a.id === 'string' && typeof a.label === 'string', `${where}: needs id and label`);
    need(a.stat === null || STATS.includes(a.stat), `${where}: stat must be one of ${STATS.join(', ')} or null`);
    checkTexts(a.texts, `${where} texts`);
    if (a.failTexts) checkTexts(a.failTexts, `${where} failTexts`);
  }

  // events.json
  for (const e of data.events) {
    const where = `events.json ${e.id}`;
    need(['life', 'war', 'night'].includes(e.phase), `${where}: phase must be "life", "war" or "night"`);
    checkRestrictions(e, where);
    checkEffects(e.effects, where);
    if (e.choices !== undefined) {
      need(Array.isArray(e.choices) && e.choices.length, `${where}: choices must be a non-empty list`);
      (e.choices || []).forEach((c, i) => {
        const cw = `${where} choice #${i + 1}`;
        need(typeof c.label === 'string' && c.label, `${cw}: needs a label`);
        checkRestrictions(c, cw);
        checkEffects(c.effects, cw);
      });
      need((e.choices || []).some((c) => !c.conditions), `${where}: at least one choice must have no conditions, so the player is never stuck`);
    }
  }

  // servants.json: everything the profile, combat and AI chat will need.
  const servantIds = new Set(data.servants.map((s) => s.id));
  for (const s of data.servants) {
    const where = `servants.json ${s.id}`;
    need(['male', 'female'].includes(s.sex), `${where}: sex must be "male" or "female"`);
    need(Number.isFinite(s.hp) && s.hp > 0, `${where}: hp must be a positive number`);
    for (const k of Object.keys(STAT_LABELS)) need(RANKS.includes(s.stats?.[k]), `${where}: stats.${k} must be a rank (E, D, C, B, A, EX)`);
    need(Array.isArray(s.skills) && s.skills.length >= 2 && s.skills.length <= 3, `${where}: needs 2–3 skills`);
    (s.skills || []).forEach((sk, i) => need(sk.name && RANKS.includes(sk.rank) && sk.description, `${where} skill #${i + 1}: needs name, rank and description`));
    const np = s.noblePhantasm || {};
    need(np.name && RANKS.includes(np.rank) && np.type && np.description, `${where}: noblePhantasm needs name, rank, type and description`);
    const p = s.personality || {};
    for (const k of ['speechStyle', 'backstory', 'wish']) need(typeof p[k] === 'string' && p[k], `${where}: personality.${k} is missing`);
    for (const k of ['tags', 'likes', 'dislikes']) need(Array.isArray(p[k]) && p[k].length, `${where}: personality.${k} must be a non-empty list`);
    const c = s.compatibility || {};
    for (const k of Object.keys(c.stats || {})) need(STATS.includes(k), `${where}: compatibility.stats.${k} is not a Master stat`);
    for (const k of Object.keys(c.traits || {})) need(data.traits.some((t) => t.id === k), `${where}: compatibility.traits.${k} is not a trait id`);
    for (const k of Object.keys(c.families || {})) need(data.families.some((f) => f.id === k), `${where}: compatibility.families.${k} is not a family id`);
  }

  // dialogue.json: fallback lines for every Servant, notices, Bond bands.
  const dlg = data.dialogue || {};
  for (const k of ['stub', 'offline', 'busy']) need(typeof dlg.notices?.[k] === 'string', `dialogue.json: notices.${k} is missing`);
  need(Array.isArray(dlg.bondBands) && dlg.bondBands.some((b) => b.min === 0), 'dialogue.json: bondBands needs a band starting at 0');
  for (const s of data.servants) {
    need(typeof s.name === 'string' && s.name, `servants.json ${s.id}: needs a short "name" (used in chat)`);
    for (const k of ['greetings', 'replies', 'farewells']) {
      const list = dlg.servants?.[s.id]?.[k];
      need(Array.isArray(list) && list.length && list.every((l) => typeof l === 'string' && l), `dialogue.json: servants.${s.id}.${k} must be a non-empty list of lines`);
    }
  }
  const c = r.chat || {};
  need(['maxPlayerMessages', 'maxMessageLength', 'historyMessages', 'memoriesInContext', 'maxMemories'].every((k) => Number.isInteger(c[k]) && c[k] > 0), 'rules.chat needs positive whole numbers for its limits');
  need(isRange(c.bondChange), 'rules.chat.bondChange must be [min, max]');

  // war.json and rules.war
  const war = data.war || {};
  for (const key of ['intro', 'dawn', 'dusk', 'end']) checkTexts(war[key], `war.json ${key}`);
  const dayIds = ['rest', 'train', 'intel', 'workshop', 'ally', 'talk'];
  const nightIds = ['patrol', 'scout', 'ambush', 'hide'];
  for (const [key, ids] of [['dayActions', dayIds], ['nightActions', nightIds]]) {
    const list = war[key] || [];
    need(ids.every((id) => list.some((a) => a.id === id)), `war.json ${key}: needs actions ${ids.join(', ')}`);
    for (const a of list) {
      need(typeof a.label === 'string' && typeof a.hint === 'string', `war.json ${key} ${a.id}: needs label and hint`);
      if (!['talk', 'ambush'].includes(a.id)) checkTexts(a.texts, `war.json ${key} ${a.id} texts`);
    }
  }
  const intelAction = (war.dayActions || []).find((a) => a.id === 'intel') || {};
  checkTexts(intelAction.rumors, 'war.json intel rumors');
  checkTexts(intelAction.nothing, 'war.json intel nothing');
  checkTexts((war.nightActions || []).find((a) => a.id === 'patrol')?.quiet, 'war.json patrol quiet');
  const rw = r.war || {};
  need(Number.isInteger(rw.days) && rw.days > 0, 'rules.war.days must be a positive whole number');
  need(rw.eventsPerDay && Object.keys(rw.eventsPerDay).every((k) => /^\d+$/.test(k)), 'rules.war.eventsPerDay must map counts to weights');
  need(Array.isArray(rw.workshop?.cost) && rw.workshop.cost.length >= rw.workshop.maxLevel, 'rules.war.workshop needs a cost for every level');
  need(isRange(rw.train?.gain), 'rules.war.train.gain must be [min, max]');

  // rivals.json: every war has all Servants, so there must be exactly one
  // rival per other Servant.
  const rv = data.rivals || {};
  need(rv.count === data.servants.length - 1, `rivals.json: count must be ${data.servants.length - 1} (one rival for each Servant except the player's)`);
  need(isRange(rv.age), 'rivals.json: age must be [min, max]');
  need(Object.keys(rv.familyWeights || {}).every((k) => data.families.some((f) => f.id === k)), 'rivals.json: familyWeights must use family ids');
  need(Array.isArray(rv.personalities) && rv.personalities.length, 'rivals.json: needs personalities');
  for (const p of rv.personalities || []) {
    need(isRange(p.aggression) && p.aggression[0] >= 0 && p.aggression[1] <= 100, `rivals.json personality ${p.id}: aggression must be [min, max] within 0–100`);
    need(Array.isArray(p.descriptions) && p.descriptions.length, `rivals.json personality ${p.id}: needs descriptions`);
    need(typeof rv.personalityNotes?.[p.id] === 'string', `rivals.json: personalityNotes.${p.id} is missing`);
  }
  checkTexts(rv.bases, 'rivals.json bases');
  need(rv.ai && rv.ai.weights, 'rivals.json: ai.weights is missing');
  for (const k of ['clash', 'clashDetailKnown', 'clashDetailUnknown', 'eliminated', 'eliminatedKnown', 'alliance', 'watched', 'ransacked', 'allyIntel', 'allyBetrays', 'allianceEnds']) checkTexts(rv.news?.[k], `rivals.json news.${k}`);
  for (const k of ['finalNight', 'rivalsDecide', 'lastRival', 'allEliminated']) checkTexts(data.war?.[k], `war.json ${k}`);
  for (const key of ['master1', 'master2', 'master3', 'servant1', 'servant2', 'servant3']) checkTexts(rv.intelTexts?.[key], `rivals.json intelTexts.${key}`);
  for (const p of data.places) {
    need(Array.isArray(p.districts) && p.districts.length >= 1, `places.json ${p.id}: needs districts`);
    for (const e of data.eras) {
      for (const y of e.warYears) {
        const ctx = { year: y, placeId: p.id };
        need((rv.bases || []).some((b) => (b.from ?? 0) <= y && y <= (b.to ?? 9999) && (!b.conditions?.places || b.conditions.places.includes(ctx.placeId))), `rivals.json bases: none fit ${p.name} in ${y}`);
      }
    }
  }

  // classes.json and combat data (milestone 8)
  const SKILL_TYPES = ['buff', 'weaken', 'strike', 'heal', 'gamble', 'guard', 'reveal', 'stun', 'dot', 'lastStand'];
  for (const sv of data.servants) {
    need(data.classes.some((c) => c.id === sv.class), `classes.json: no entry for class ${sv.class} (${sv.id})`);
    sv.skills.forEach((sk, i) => need(SKILL_TYPES.includes(sk.combat?.type), `servants.json ${sv.id} skill #${i + 1}: combat.type must be one of ${SKILL_TYPES.join(', ')}`));
    need(sv.noblePhantasm.combat && typeof sv.noblePhantasm.combat.text === 'string', `servants.json ${sv.id}: noblePhantasm.combat is missing`);
    need(Number.isInteger(sv.betrayalBond), `servants.json ${sv.id}: betrayalBond must be a whole number (Bond change when the player betrays an ally)`);
  }
  for (const c of data.classes) need(Array.isArray(c.attackVerbs) && c.attackVerbs.length, `classes.json ${c.id}: needs attackVerbs`);
  const cb = data.combat || {};
  for (const k of ['ambush', 'spotted', 'patrol', 'raid', 'final', 'betrayal']) checkTexts(cb.start?.[k], `combat.json start.${k}`);
  for (const k of ['church', 'churchKilled', 'masterDied', 'victory']) checkTexts(cb.epilogues?.[k], `combat.json epilogues.${k}`);
  need(cb.lines && cb.results && cb.afterLoss && cb.youLines, 'combat.json: needs lines, youLines, results and afterLoss');
  need(r.combat && Number.isInteger(r.combat.maxRounds), 'rules.combat is missing or incomplete');

  const summon = data.summon || {};
  for (const key of ['intro', 'withCatalyst', 'withoutCatalyst', 'compatibilityNote']) checkTexts(summon[key], `summon.json ${key}`);
  need(Number.isFinite(r.summon?.startingBond) && Number.isFinite(r.summon?.compatibilityTemperature), 'rules.summon needs startingBond and compatibilityTemperature');

  for (const c of data.catalysts) {
    need(Array.isArray(c.servants) && c.servants.length, `catalysts.json ${c.id}: needs a "servants" list`);
    for (const id of c.servants || []) need(servantIds.has(id), `catalysts.json ${c.id}: unknown servant "${id}"`);
    for (const k of ['placeWeights', 'familyWeights']) {
      need(c[k] === undefined || Object.values(c[k]).every(Number.isFinite), `catalysts.json ${c.id}: ${k} values must be numbers`);
    }
  }

  function checkTexts(list, where) {
    if (!Array.isArray(list) || !list.length) {
      problems.push(`${where}: must be a non-empty list of { "text": ... }`);
      return;
    }
    list.forEach((t, i) => {
      need(typeof t?.text === 'string' && t.text, `${where} #${i + 1}: missing "text"`);
      checkRestrictions(t, `${where} #${i + 1}`);
    });
  }

  function checkRestrictions(entry, where) {
    checkYears(entry, where);
    for (const k of ['minAge', 'maxAge', 'minDay', 'maxDay']) need(entry[k] === undefined || Number.isInteger(entry[k]), `${where}: "${k}" must be a whole number`);
    if (entry.conditions !== undefined) {
      const bad = Object.keys(entry.conditions).filter((k) => !CONDITION_KEYS.includes(k));
      need(!bad.length, `${where}: unknown condition "${bad[0]}" (use ${CONDITION_KEYS.join(', ')})`);
    }
  }

  function checkEffects(fx, where) {
    if (fx === undefined) return;
    const bad = Object.keys(fx).filter((k) => !EFFECT_KEYS.includes(k));
    need(!bad.length, `${where}: unknown effect "${bad[0]}" (use ${EFFECT_KEYS.join(', ')})`);
    for (const [k, v] of Object.entries(fx.stats || {})) {
      need(STATS.includes(k) && Number.isFinite(v), `${where}: stats.${k} must be a known stat and a number`);
    }
  }

  function checkYears(entry, where) {
    if (typeof entry !== 'object' || entry === null) return;
    for (const k of ['from', 'to']) {
      need(entry[k] === undefined || Number.isInteger(entry[k]), `${where}: "${k}" must be a year`);
    }
    need(!(entry.from > entry.to), `${where}: "from" is after "to"`);
  }

  if (problems.length) {
    throw new Error(`Problems in the data files:\n• ${problems.join('\n• ')}`);
  }
}
