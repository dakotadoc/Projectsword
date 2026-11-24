// The Status tab: an overview of the numbers. Built fresh from state every
// time the tab opens. Shows ONLY what the player knows: rivals appear as
// "???" until intel reveals them (milestone 7).

import { findById, getData } from './data.js';
import { STAT_LABELS } from './ranks.js';
import { bondBand } from './servantTalk.js';
import { timeOfDay } from './war.js';

const PHASES = { birth: 'Birth', life: 'Life', summon: 'Summoning', chat: 'Talking with your Servant', war: 'The war' };
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
  const band = bondBand(sv.bond);
  const np = s.noblePhantasm;
  return section(`${s.class}: ${s.name}`, [
    para(`“${s.title}”`, 'status-note'),
    table([
      ['True name', s.trueName],
      ['Origin', s.origin],
      ['Mood', sv.mood ? capitalize(sv.mood) : '—'],
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

// Rival Masters and Servants: only what the player has learned.
function rivalsSection(state) {
  const rivals = state.rivals || [];
  if (!rivals.length) {
    return section('Other Masters and Servants', [
      para(state.war
        ? 'You know nothing about the other Masters yet.'
        : 'The other Masters have not shown themselves. When the war begins, anything you learn about them will appear here.'),
    ]);
  }
  // Milestone 7 fills this in with intel levels and "???" for unknowns.
  return section('Other Masters and Servants', [para(`${rivals.length} rivals.`)]);
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
