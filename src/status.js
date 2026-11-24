// The Status tab: an overview of the numbers. Built fresh from state every
// time the tab opens. Shows ONLY what the player knows: rivals appear as
// "???" until intel reveals them (milestone 7).

import { findById, getData } from './data.js';
import { STAT_LABELS } from './ranks.js';
import { bondBand } from './servantTalk.js';
import { timeOfDay } from './war.js';
import { knownView } from './intel.js';
import { pathLabel } from './bond.js';

const PHASES = { birth: 'Birth', life: 'Life', summon: 'Summoning', chat: 'Talking with your Servant', war: 'The war', battle: 'In battle', ending: 'Game over' };
const SERVANT_STAT_NAMES = {
  strength: 'Strength', endurance: 'Endurance', agility: 'Agility', mana: 'Mana', luck: 'Luck', noblePhantasm: 'Noble Phantasm',
};

export function renderStatus(root, state) {
  root.replaceChildren();
  const page = el('div', 'status-page');
  root.append(page);

  if (!state || !state.master) {
    page.append(section('Status', [para('Your story has not begun yet. Start a game, and your details will appear here.')]));
    return;
  }
  page.append(progressSection(state), masterSection(state), servantSection(state), rivalsSection(state));
}

// ---- Sections ----

function progressSection(state) {
  const rows = [['Phase', PHASES[state.screen] || '—']];
  const life = state.life;
  if (state.screen === 'life' && life && life.stage !== 'done') {
    rows.push(['Turn', `${life.turn + 1} of ${life.turns.length}`]);
  }
  if (state.war) {
    rows.push(['Masters left', `${(state.rivals || []).filter((r) => r.status === 'active').length + 1} (counting you)`]);
    const ally = state.war.ally && state.rivals.find((r) => r.id === state.war.ally);
    if (ally) rows.push(['Ally', knownView(ally).title]);
    const days = getData('rules').war.days;
    rows.push(['Day', `${Math.min(state.war.day, days)} of ${days}`], ['Time', timeOfDay(state)]);
  }
  return section('Progress', [table(rows)]);
}

function masterSection(state) {
  const m = state.master;
  const place = findById('places', state.world.placeId);
  const era = findById('eras', state.world.eraId);
  const family = findById('families', m.familyId);
  const trait = findById('traits', m.traitId);
  const age = currentAge(state);
  const seals = m.commandSeals ? `${m.commandSeals} of 3` : 'Not yet';
  const catalysts = (m.catalysts || []).map((id) => findById('catalysts', id).name);

  return section(m.name, [
    table([
      ['Sex', m.sex === 'female' ? 'Female' : 'Male'],
      ['Age', age === 0 ? 'Newborn' : String(age)],
      ['Born', `${place.name}, ${place.country}, ${m.birthYear}`],
      ['Year', String(m.birthYear + age)],
      ['Era', era.name],
      ['Family', family.name],
      ['Trait', trait.name],
      ['Magic Circuits', `Quantity ${m.circuits.quantity} · Quality ${m.circuits.quality}`],
    ]),
    para(trait.description, 'status-note'),
    subheading('Abilities'),
    meters([
      ...(m.hp ? [['HP', m.hp.current, m.hp.max]] : []),
      ['Body', m.stats.body, 100],
      ['Magecraft', m.stats.magecraft, 100],
      ['Mind', m.stats.mind, 100],
      ['Charisma', m.stats.charisma, 100],
      ['Mana', m.mana.current, m.mana.max],
    ]),
    subheading('Resources'),
    table([
      ['Command Seals', seals],
      ['Money', String(m.money)],
      ['Contacts', String(m.contacts)],
      ['Catalysts', catalysts.length ? catalysts.join(', ') : 'None'],
      ...(state.war ? [['Workshop', state.war.workshop ? `Level ${state.war.workshop}` : 'None']] : []),
    ]),
  ]);
}

function servantSection(state) {
  const sv = state.servant;
  if (!sv) return section('Servant', [para('Not yet summoned.')]);
  const s = findById('servants', sv.id);
  if (sv.status === 'lost') return section(`${s.class}: ${s.name}`, [para('Lost. You fight on alone.')]);
  const band = bondBand(sv.bond, sv.path);
  const np = s.noblePhantasm;
  return section(`${s.class}: ${s.name}`, [
    para(`“${s.title}”`, 'status-note'),
    table([
      ['True name', s.trueName],
      ['Origin', s.origin],
      ['Mood', sv.mood ? capitalize(sv.mood) : '—'],
      ['Relationship', pathLabel(sv.path)],
    ]),
    meters([
      ['HP', sv.hp.current, sv.hp.max],
      [`Bond (${band.label})`, sv.bond, 100],
    ]),
    subheading('Parameters'),
    rankGrid(s.stats),
    subheading('Skills'),
    list(s.skills.map((sk) => [`${sk.name} (${sk.rank})`, sk.description])),
    subheading('Noble Phantasm'),
    list([[`${np.name} (${np.rank}, ${np.type})`, np.description]]),
    subheading('Weakness'),
    para(s.weakness),
  ]);
}

// Rival Masters and Servants: only what the player has learned, through
// knownView() in intel.js. Unknowns show as "???".
function rivalsSection(state) {
  const rivals = state.rivals || [];
  if (!rivals.length) {
    return section('Other Masters and Servants', [
      para('The other Masters have not shown themselves. When the war begins, anything you learn about them will appear here.'),
    ]);
  }
  const known = rivals.filter((r) => r.intel.master || r.intel.servant).length;
  const cards = rivals.map((r) => rivalCard({ ...knownView(r), ally: state.war?.ally === r.id }));
  return section('Other Masters and Servants', [
    para(`${rivals.length} rival Masters. You know something about ${known} of them.`, 'status-note'),
    ...cards,
  ]);
}

const UNKNOWN = '???';
const or = (v) => (v === null || v === undefined ? UNKNOWN : String(v));

function rivalCard(v) {
  const card = el('div', 'rival-card');
  const tag = v.status === 'eliminated' ? ' · out of the war' : v.ally ? ' · your ally' : '';
  card.append(el('h3', 'rival-title', v.title + tag));
  const m = v.master;
  card.append(
    el('h4', 'status-subheading', `Master · intel ${m.level}/3`),
    table([
      ['Name', or(m.name)],
      ['Seen around', or(m.district)],
      ['Base', or(m.base)],
      ['Family', or(m.family)],
      ['Age', or(m.age)],
      ['From', or(m.origin)],
      ['Personality', or(m.personality)],
    ]),
  );
  if (m.description) card.append(para(m.description, 'status-note'));
  card.append(m.aggression === null
    ? table([['Aggression', UNKNOWN]])
    : aggressionMeter(m.aggression));

  const s = v.servant;
  card.append(
    el('h4', 'status-subheading', `Servant · intel ${s.level}/3`),
    table([
      ['Class', or(s.class)],
      ['True name', or(s.trueName)],
    ]),
    rankGrid(s.stats || {}),
  );
  if (s.noblePhantasm) {
    card.append(list([[`${s.noblePhantasm.name} (${s.noblePhantasm.rank}, ${s.noblePhantasm.type})`, s.noblePhantasm.description]]));
  } else {
    card.append(table([['Noble Phantasm', UNKNOWN]]));
  }
  card.append(table([['Weakness', or(s.weakness)]]));
  return card;
}

// 0 = stays inside their bounded field, 100 = hunts other Masters.
function aggressionMeter(value) {
  const box = el('div', 'status-meters');
  const row = el('div', 'meter');
  const head = el('div', 'meter-head');
  head.append(el('span', 'meter-label', 'Aggression'), el('span', 'meter-value', String(value)));
  const bar = el('div', 'meter-bar');
  const fill = el('div', 'meter-fill meter-fill-danger');
  fill.style.width = `${value}%`;
  bar.append(fill);
  const ends = el('div', 'meter-ends');
  ends.append(el('span', '', 'Stays in their bounded field'), el('span', '', 'Hunts others'));
  row.append(head, bar, ends);
  box.append(row);
  return box;
}

// ---- Helpers ----

// The Master's age right now, wherever they are in the story.
export function currentAge(state) {
  const life = state.life;
  if (!life) return state.screen === 'birth' ? 0 : getData('rules').lifeStartAge;
  if (life.stage !== 'done') return life.turns[Math.min(life.turn, life.turns.length - 1)].age;
  return state.master.warAge;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function section(title, children) {
  const s = el('section', 'status-section');
  s.append(el('h2', 'status-heading', title), ...children);
  return s;
}

function subheading(text) {
  return el('h3', 'status-subheading', text);
}

function para(text, className = '') {
  return el('p', `status-text ${className}`.trim(), text);
}

function table(rows) {
  const dl = el('dl', 'status-table');
  for (const [k, v] of rows) dl.append(el('dt', '', k), el('dd', '', v));
  return dl;
}

// Labeled bars, e.g. Body 34 / 100.
function meters(rows) {
  const box = el('div', 'status-meters');
  for (const [label, value, max] of rows) {
    const row = el('div', 'meter');
    const head = el('div', 'meter-head');
    head.append(el('span', 'meter-label', label), el('span', 'meter-value', max === 100 ? String(value) : `${value} / ${max}`));
    const bar = el('div', 'meter-bar');
    const fill = el('div', 'meter-fill');
    fill.style.width = `${max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0}%`;
    bar.append(fill);
    row.append(head, bar);
    box.append(row);
  }
  return box;
}

function rankGrid(stats) {
  const grid = el('div', 'rank-grid');
  for (const key of Object.keys(STAT_LABELS)) {
    const cell = el('div', 'rank-cell');
    cell.append(el('span', 'rank-label', SERVANT_STAT_NAMES[key]), el('span', 'rank-value', stats[key] ?? '???'));
    grid.append(cell);
  }
  return grid;
}

function list(items) {
  const ul = el('ul', 'status-list');
  for (const [title, text] of items) {
    const li = el('li');
    li.append(el('strong', '', title), el('span', '', ` ${text}`));
    ul.append(li);
  }
  return ul;
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
