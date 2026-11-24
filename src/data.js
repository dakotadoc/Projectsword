// Loads the content files in /data once at startup and checks them, so a
// typo in a JSON file shows a clear message instead of breaking mid-game.
//
// Use getData('places') etc. after loadData() has finished, and
// findById('places', id) to look up something a save refers to.

import { RANKS } from './ranks.js';

const FILES = ['rules', 'places', 'eras', 'families', 'traits'];

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
    });
  }

  for (const p of data.places) {
    need(Array.isArray(p.givenNames) && p.givenNames.length, `places.json ${p.id}: needs givenNames`);
    need(Array.isArray(p.familyNames) && p.familyNames.length, `places.json ${p.id}: needs familyNames`);
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

  if (problems.length) {
    throw new Error(`Problems in the data files:\n• ${problems.join('\n• ')}`);
  }
}
