// The debug menu: a dialog (Debug button in the top bar) for editing the
// current run by hand. Stats, resources, catalysts, the Servant's Bond and
// HP, and rival intel. Changes are written to state, noted in the log, and
// saved; state.debugUsed marks the run (shown in the run summary).

import * as ui from './ui.js';
import { getState } from './state.js';
import { getData, findById } from './data.js';
import { formField, numberInput, checkboxList, formGrid, formHeading } from './forms.js';

const STATS = [['body', 'Body'], ['magecraft', 'Magecraft'], ['mind', 'Mind'], ['charisma', 'Charisma']];

// onApplied(): called after changes are saved (main.js refreshes the screen).
export function openDebug(onApplied) {
  const state = getState();
  if (!state?.master) {
    ui.showDialog({ title: 'Debug', text: 'There is nothing to edit until you are born.' });
    return;
  }
  const m = state.master;
  const sv = state.servant && state.servant.status !== 'lost' ? state.servant : null;
  const n = (value, min, max) => numberInput({ min, max, value });

  const f = {
    stats: Object.fromEntries(STATS.map(([k]) => [k, n(m.stats[k], 0, 100)])),
    money: n(m.money, 0, 99999),
    contacts: n(m.contacts, 0, 99),
    mana: n(m.mana.current, 0, 9999),
    manaMax: n(m.mana.max, 1, 9999),
    seals: n(m.commandSeals, 0, 3),
    hp: m.hp ? n(m.hp.current, 1, 9999) : null,
    hpMax: m.hp ? n(m.hp.max, 1, 9999) : null,
    bond: sv ? n(sv.bond, 0, 100) : null,
    servantHp: sv ? n(sv.hp.current, 1, sv.hp.max) : null,
    catalysts: checkboxList(getData('catalysts').map((c) => [c.id, `${c.name} (${servantNames(c)})`]), m.catalysts),
    reveal: state.rivals?.length ? checkboxList([['all', 'Reveal everything about every rival (intel 3 on both tracks)']]) : null,
  };
  const error = document.createElement('p');
  error.className = 'dialog-note dialog-error';
  error.setAttribute('role', 'alert');

  const content = document.createElement('div');
  content.append(
    formHeading('Stats'),
    formGrid(STATS.map(([k, label]) => formField(label, f.stats[k]))),
    formHeading('Resources'),
    formGrid([
      formField('Money', f.money), formField('Contacts', f.contacts),
      formField('Mana', f.mana), formField('Max mana', f.manaMax),
      formField('Command Seals', f.seals),
      ...(f.hp ? [formField('Your HP', f.hp), formField('Your max HP', f.hpMax)] : []),
    ]),
  );
  if (sv) {
    const s = findById('servants', sv.id);
    content.append(formHeading(s.name), formGrid([formField('Bond', f.bond), formField(`HP (max ${sv.hp.max})`, f.servantHp)]));
  }
  content.append(formHeading('Catalysts'), formField('Catalysts you hold', f.catalysts.node, { wide: true }));
  if (state.servant) content.append(hint('You have already summoned; catalysts only matter before the summoning.'));
  if (f.reveal) content.append(formHeading('Rivals'), formField('Intel', f.reveal.node, { wide: true }));
  content.append(error);

  ui.showDialog({
    title: 'Debug',
    text: 'Edit this run. Changes are saved and noted in the story log.',
    content,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Apply',
        style: 'primary',
        onSelect: async () => {
          const problem = apply(state, f);
          if (problem) {
            error.textContent = problem;
            return false;
          }
          await onApplied();
        },
      },
    ],
  });
}

function hint(text) {
  const p = document.createElement('p');
  p.className = 'dialog-note';
  p.textContent = text;
  return p;
}

function servantNames(catalyst) {
  return catalyst.servants.map((id) => findById('servants', id).name).join(', ');
}

// Validate everything first, then write. Returns an error message or null.
function apply(state, f) {
  const m = state.master;
  const read = (input, label, min, max) => {
    const v = Number(input.value);
    if (input.value.trim() === '' || !Number.isInteger(v) || v < min || v > max) throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
    return v;
  };
  let v;
  try {
    v = {
      stats: Object.fromEntries(STATS.map(([k, label]) => [k, read(f.stats[k], label, 0, 100)])),
      money: read(f.money, 'Money', 0, 99999),
      contacts: read(f.contacts, 'Contacts', 0, 99),
      manaMax: read(f.manaMax, 'Max mana', 1, 9999),
      seals: read(f.seals, 'Command Seals', 0, 3),
    };
    v.mana = read(f.mana, 'Mana', 0, v.manaMax);
    if (f.hp) {
      v.hpMax = read(f.hpMax, 'Your max HP', 1, 9999);
      v.hp = read(f.hp, 'Your HP', 1, v.hpMax);
    }
    if (f.bond) {
      v.bond = read(f.bond, 'Bond', 0, 100);
      v.servantHp = read(f.servantHp, 'Servant HP', 1, state.servant.hp.max);
    }
  } catch (err) {
    return err.message;
  }

  const changes = [];
  const set = (label, before, after) => { if (before !== after) changes.push(`${label} ${before} → ${after}`); };
  for (const [k, label] of STATS) { set(label, m.stats[k], v.stats[k]); m.stats[k] = v.stats[k]; }
  set('Money', m.money, v.money); m.money = v.money;
  set('Contacts', m.contacts, v.contacts); m.contacts = v.contacts;
  set('Max mana', m.mana.max, v.manaMax); m.mana.max = v.manaMax;
  set('Mana', m.mana.current, v.mana); m.mana.current = v.mana;
  set('Command Seals', m.commandSeals, v.seals); m.commandSeals = v.seals;
  if (m.hp && v.hp !== undefined) {
    set('Max HP', m.hp.max, v.hpMax); m.hp.max = v.hpMax;
    set('HP', m.hp.current, v.hp); m.hp.current = v.hp;
  }
  if (v.bond !== undefined) {
    const sv = state.servant;
    set('Bond', sv.bond, v.bond); sv.bond = v.bond;
    set('Servant HP', sv.hp.current, v.servantHp); sv.hp.current = v.servantHp;
  }
  const cats = f.catalysts.values();
  const added = cats.filter((id) => !m.catalysts.includes(id));
  const removed = m.catalysts.filter((id) => !cats.includes(id));
  if (added.length) changes.push(`gained ${added.map((id) => findById('catalysts', id).name).join(', ')}`);
  if (removed.length) changes.push(`removed ${removed.map((id) => findById('catalysts', id).name).join(', ')}`);
  m.catalysts = cats;
  if (f.reveal?.values().length) {
    for (const r of state.rivals) r.intel = { master: 3, servant: 3 };
    changes.push('every rival revealed');
  }
  if (changes.length) {
    state.debugUsed = true;
    ui.log(`Debug: ${changes.join(' · ')}`, 'system');
  }
  return null;
}
