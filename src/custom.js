// Custom runs: a form on the title menu where the player chooses their birth
// by hand (place, year, family, circuits, trait, stats…). Anything left blank
// is rolled as usual. The choices are stored as state.custom and used by
// rollBirth (birth.js); the run then starts at birth like any other.
//
// state.custom = { sex, name?, placeId?, birthYear?, warAge?, familyId?,
//                  warAgeRange?, quantity?, quality?, traitId?, stats?: {…}, money?,
//                  contacts?, catalysts?: [ids] }

import * as ui from './ui.js';
import { getData, findById } from './data.js';
import { RANKS } from './ranks.js';
import { formField, select, numberInput, textInput, checkboxList, formGrid } from './forms.js';

const STATS = [['body', 'Body'], ['magecraft', 'Magecraft'], ['mind', 'Mind'], ['charisma', 'Charisma']];

// Birth and war years the game's content and name lists cover.
export function yearLimits() {
  const eras = getData('eras');
  const [minAge, maxAge] = getData('rules').warAge;
  const firstWar = Math.min(...eras.map((e) => e.warYears[0]));
  const lastWar = Math.max(...eras.map((e) => e.warYears[1]));
  return { firstWar, lastWar, firstBirth: firstWar - maxAge, lastBirth: lastWar - minAge, minAge, maxAge };
}

// Opens the form. start({ seed, custom }) begins the run.
export function openCustomRun(start) {
  const lim = yearLimits();
  const random = ['', 'Random'];
  const f = {
    seed: textInput({ placeholder: 'Blank for a random seed', maxLength: 64 }),
    name: textInput({ placeholder: 'Blank to roll one', maxLength: 60 }),
    sex: select([['female', 'Girl'], ['male', 'Boy']]),
    place: select([random, ...getData('places').map((p) => [p.id, `${p.name}, ${p.country}`])]),
    birthYear: numberInput({ min: lim.firstBirth, max: lim.lastBirth, placeholder: `${lim.firstBirth}–${lim.lastBirth}` }),
    warAge: select([random, ...range(lim.minAge, lim.maxAge).map((a) => [String(a), String(a)])]),
    family: select([random, ...getData('families').map((x) => [x.id, x.name])]),
    quantity: select([random, ...RANKS.map((r) => [r, r])]),
    quality: select([random, ...RANKS.map((r) => [r, r])]),
    trait: select([random, ...getData('traits').map((t) => [t.id, t.name])]),
    stats: Object.fromEntries(STATS.map(([k]) => [k, numberInput({ min: 0, max: 100, placeholder: 'Random' })])),
    money: numberInput({ min: 0, max: 99999, placeholder: 'Random' }),
    contacts: numberInput({ min: 0, max: 99, placeholder: 'Random' }),
    catalysts: checkboxList(getData('catalysts').map((c) => [c.id, `${c.name} (${c.servants.map((id) => findById('servants', id).name).join(', ')})`])),
  };
  const error = document.createElement('p');
  error.className = 'dialog-note dialog-error';
  error.setAttribute('role', 'alert');

  const content = document.createElement('div');
  content.className = 'form-scroll';
  content.append(
    formGrid([
      formField('Seed', f.seed), formField('Name', f.name),
      formField('Born a', f.sex), formField('Birthplace', f.place),
      formField('Birth year', f.birthYear), formField('Age at the war', f.warAge),
      formField('Family', f.family), formField('Trait', f.trait),
      formField('Circuit quantity', f.quantity), formField('Circuit quality', f.quality),
      ...STATS.map(([k, label]) => formField(label, f.stats[k])),
      formField('Money', f.money), formField('Contacts', f.contacts),
    ]),
    formField('Starting catalysts', f.catalysts.node, { wide: true }),
    error,
  );

  ui.showDialog({
    title: 'Custom run',
    text: 'Choose anything you like; leave the rest blank to roll it. The war takes place in your birthplace, in your birth year plus your age at the war.',
    content,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Start',
        style: 'primary',
        onSelect: () => {
          const result = readForm(f, lim);
          if (result.error) {
            error.textContent = result.error;
            return false;
          }
          setTimeout(() => start(result), 0);
        },
      },
    ],
  });
}

function readForm(f, lim) {
  const custom = { sex: f.sex.value };
  const num = (input) => (input.value.trim() === '' ? null : Number(input.value));
  if (f.name.value.trim()) custom.name = f.name.value.trim().replace(/\s+/g, ' ');
  if (f.place.value) custom.placeId = f.place.value;
  if (f.family.value) custom.familyId = f.family.value;
  if (f.trait.value) custom.traitId = f.trait.value;
  if (f.quantity.value) custom.quantity = f.quantity.value;
  if (f.quality.value) custom.quality = f.quality.value;
  if (f.warAge.value) custom.warAge = Number(f.warAge.value);

  const birthYear = num(f.birthYear);
  if (birthYear !== null) {
    if (!Number.isInteger(birthYear) || birthYear < lim.firstBirth || birthYear > lim.lastBirth) {
      return { error: `Birth year must be a whole number from ${lim.firstBirth} to ${lim.lastBirth}.` };
    }
    custom.birthYear = birthYear;
    // Without a chosen age, pick one that keeps the war inside the game's years.
    const ages = range(lim.minAge, lim.maxAge).filter((a) => birthYear + a >= lim.firstWar && birthYear + a <= lim.lastWar);
    if (custom.warAge !== undefined && !ages.includes(custom.warAge)) {
      return { error: `Born in ${birthYear}, the war must come at an age that keeps it between ${lim.firstWar} and ${lim.lastWar} (ages ${ages[0]}–${ages[ages.length - 1]}).` };
    }
    // An unchosen age is rolled by rollBirth; make sure every roll is valid.
    if (custom.warAge === undefined && ages.length < lim.maxAge - lim.minAge + 1) custom.warAgeRange = [ages[0], ages[ages.length - 1]];
  }

  const stats = {};
  for (const [k, label] of STATS) {
    const v = num(f.stats[k]);
    if (v === null) continue;
    if (!Number.isInteger(v) || v < 0 || v > 100) return { error: `${label} must be a whole number from 0 to 100.` };
    stats[k] = v;
  }
  if (Object.keys(stats).length) custom.stats = stats;
  for (const [key, max] of [['money', 99999], ['contacts', 99]]) {
    const v = num(f[key]);
    if (v === null) continue;
    if (!Number.isInteger(v) || v < 0 || v > max) return { error: `${key === 'money' ? 'Money' : 'Contacts'} must be a whole number from 0 to ${max}.` };
    custom[key] = v;
  }
  const cats = f.catalysts.values();
  if (cats.length) custom.catalysts = cats;
  return { seed: f.seed.value.trim() || undefined, custom };
}

function range(a, b) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}
