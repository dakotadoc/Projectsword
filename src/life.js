// Phase 2: Life. About 8–10 turns of 1–2 years each, from age 5 to the age
// the war starts. Each turn: pick an action, then a life event rolls (some
// events offer a choice). Ends with a summary and the war announcement.
//
// state.life = {
//   turns: [{ age, years }],  // the planned turns, ending exactly at war age
//   turn: 0,                  // index of the current turn
//   stage: 'action' | 'event' | 'done',
//   eventId: null,            // event waiting for a choice (stage 'event')
//   seenEvents: [],           // events don't repeat within a run
//   history: [{ age, year, action, eventId, choice }],  // one per turn;
//                             // later used for run summary and AI context
// }

import { decideHeir } from './family.js';
import * as ui from './ui.js';
import { getState } from './state.js';
import { getData, findById } from './data.js';
import { randInt, chance, shuffle } from './rng.js';
import {
  makeContext, fits, pickText, fillText, rollEvent, applyEffects, resolveChoice, choiceHint,
} from './events.js';
import { relicSearchChance, findCatalyst } from './catalysts.js';
import { playScene } from './fx.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export async function lifeScreen({ resumed = false, goTo, autosave }) {
  const state = getState();
  const nav = { goTo, autosave };
  state.master.catalysts ??= [];

  if (!state.life) {
    state.life = { turns: planTurns(state), turn: 0, stage: 'action', eventId: null, seenEvents: [], history: [] };
    ui.log('Life', 'heading');
    ui.log(pickText(getData('life').intro, turnContext(state)));
    startTurn(state, nav);
    await autosave();
    return;
  }

  const life = state.life;
  if (life.stage === 'action') {
    if (!resumed) showTurnHeader(state);
    showActions(state, nav);
  } else if (life.stage === 'event') {
    showEventChoices(state, findById('events', life.eventId), nav);
  } else {
    showEndChoices(nav);
  }
}

// ---- Turn plan ----

// Splits the years from lifeStartAge to warAge into 8–10 turns of 1–2 years.
export function planTurns(state) {
  const rules = getData('rules');
  const total = state.master.warAge - rules.lifeStartAge;
  const [minTurns, maxTurns] = rules.lifeTurns;
  const lo = clamp(Math.ceil(total / 2), minTurns, maxTurns);
  const hi = clamp(total, minTurns, maxTurns);
  const count = Math.max(1, Math.min(total, randInt(Math.min(lo, hi), hi)));

  const lengths = new Array(count).fill(1);
  let extra = total - count;
  // Hand out the extra years one at a time to random turns (max 2 years each
  // when possible).
  while (extra > 0) {
    const open = lengths.map((len, i) => i).filter((i) => lengths[i] < 2);
    const targets = shuffle(open.length ? open : lengths.map((len, i) => i));
    lengths[targets[0]] += 1;
    extra -= 1;
  }

  const turns = [];
  let age = rules.lifeStartAge;
  for (const years of lengths) {
    turns.push({ age, years });
    age += years;
  }
  return turns;
}

function currentTurn(state) {
  return state.life.turns[state.life.turn];
}

function turnContext(state) {
  const turn = currentTurn(state) || { age: getData('rules').lifeStartAge };
  return makeContext(state, { age: turn.age, year: state.master.birthYear + turn.age });
}

function startTurn(state, nav) {
  state.life.stage = 'action';
  state.life.eventId = null;
  showTurnHeader(state);
  showActions(state, nav);
}

function showTurnHeader(state) {
  const { age, years } = currentTurn(state);
  const from = state.master.birthYear + age;
  const ages = years > 1 ? `Ages ${age}–${age + years - 1}` : `Age ${age}`;
  const yearText = years > 1 ? `${from}–${from + years - 1}` : `${from}`;
  ui.log(ages, 'heading');
  ui.log(`${yearText} · Turn ${state.life.turn + 1} of ${state.life.turns.length}`, 'system');
}

// ---- Actions ----

function showActions(state, nav) {
  const m = state.master;
  const { years } = currentTurn(state);
  const hints = {
    train_body: `Body ${m.stats.body}`,
    study_magecraft: `Magecraft ${m.stats.magecraft} · circuit quality ${m.circuits.quality}`,
    study_world: `Mind ${m.stats.mind}`,
    socialize: `Charisma ${m.stats.charisma} · Contacts ${m.contacts}`,
    search_relics: `About ${Math.round(relicSearchChance(state, years) * 100)}% chance · Found ${m.catalysts.length}`,
    work: `Money ${m.money}`,
  };
  ui.setChoices(getData('life').actions.map((action) => ({
    label: action.label,
    hint: hints[action.id] ?? '',
    onSelect: () => doAction(state, action, nav),
  })));
}

async function doAction(state, action, nav) {
  const rules = getData('rules');
  const { years } = currentTurn(state);
  const ctx = turnContext(state);
  const lines = [];
  state.life.history.push({ age: ctx.age, year: ctx.year, action: action.id, eventId: null, choice: null });

  const used = (state.life.usedTexts ??= []);
  if (action.id === 'search_relics') {
    ui.log(pickText(action.texts, ctx, used));
    if (chance(relicSearchChance(state, years))) {
      const found = findCatalyst(state, ctx);
      if (found) {
        ui.log(fillText(found.findText, ctx));
        lines.push(`Catalyst found: ${found.name}`);
      } else {
        ui.log(pickText(action.failTexts, ctx, used));
      }
    } else {
      ui.log(pickText(action.failTexts, ctx, used));
    }
  } else if (action.id === 'work') {
    // Odd jobs and errands: money, scaled by the years in the turn.
    ui.log(pickText(action.texts, ctx, used));
    let pay = 0;
    for (let y = 0; y < years; y++) pay += randInt(...rules.lifeWorkPerYear);
    lines.push(...applyEffects(state, { money: pay }, ctx));
  } else {
    ui.log(pickText(action.texts, ctx, used));
    let gain = 0;
    for (let y = 0; y < years; y++) gain += randInt(...rules.lifeGainPerYear);
    if (action.stat === 'magecraft') {
      gain *= rules.magecraftQualityMultiplier[state.master.circuits.quality] ?? 1;
    }
    const effects = { stats: { [action.stat]: Math.round(gain) } };
    if (action.id === 'socialize') {
      const c = rules.socializeContactChance;
      if (chance(Math.min(c.max, c.base + c.perCharisma * state.master.stats.charisma))) {
        effects.contacts = 1;
      }
    }
    lines.push(...applyEffects(state, effects, ctx));
  }
  logEffects(lines);
  await runEvent(state, nav);
}

// ---- Events ----

async function runEvent(state, nav) {
  const ctx = turnContext(state);
  const event = rollEvent('life', ctx, state.life.seenEvents);
  if (!event) {
    ui.log(pickText(getData('life').quietYear, ctx));
    await finishTurn(state, nav);
    return;
  }
  state.life.seenEvents.push(event.id);
  lastHistory(state).eventId = event.id;
  ui.log(fillText(event.text, ctx));
  logEffects(applyEffects(state, event.effects, ctx));

  const choices = (event.choices || []).filter((c) => fits(c, turnContext(state)));
  if (!choices.length) {
    await finishTurn(state, nav);
    return;
  }
  state.life.stage = 'event';
  state.life.eventId = event.id;
  showEventChoices(state, event, nav);
  await nav.autosave();
}

function showEventChoices(state, event, nav) {
  const ctx = turnContext(state);
  const choices = (event.choices || []).filter((c) => fits(c, ctx));
  ui.setChoices(choices.map((choice) => ({
    label: fillText(choice.label, ctx),
    hint: choiceHint(state, choice),
    onSelect: async () => {
      ui.log(`You chose: ${fillText(choice.label, ctx)}`, 'system');
      lastHistory(state).choice = choice.label;
      const { texts, lines } = resolveChoice(state, choice, ctx);
      for (const t of texts) ui.log(t.text, t.kind);
      logEffects(lines);
      await finishTurn(state, nav);
    },
  })));
}

async function finishTurn(state, nav) {
  state.life.turn += 1;
  if (state.life.turn >= state.life.turns.length) {
    await endLife(state, nav);
  } else {
    startTurn(state, nav);
  }
  await nav.autosave();
}

// ---- End of the life phase ----

async function endLife(state, nav) {
  const m = state.master;
  const s = m.stats;
  state.life.stage = 'done';
  state.life.eventId = null;
  const ctx = makeContext(state, { age: m.warAge, year: state.world.warYear });
  const catalysts = m.catalysts.map((id) => findById('catalysts', id).name);

  ui.log('Coming of age', 'heading');
  ui.log([
    `${m.name}, age ${m.warAge}`,
    `Body ${s.body} · Magecraft ${s.magecraft} · Mind ${s.mind} · Charisma ${s.charisma}`,
    `Mana ${m.mana.max} · Money ${m.money} · Contacts ${m.contacts}`,
    `Catalysts: ${catalysts.length ? catalysts.join(', ') : 'none'}`,
  ].join('\n'), 'card');

  ui.log(pickText(getData('life').warAnnouncement, ctx));
  await ui.afterTyping();
  await playScene('seals');
  m.commandSeals = 3;
  logEffects(['Command Seals: 3']);
  // Old lineages decide who carries the family's catalyst (family.js).
  const heir = decideHeir(state, ctx);
  if (heir) {
    ui.log('The heir', 'heading');
    for (const t of heir.texts) ui.log(t);
    logEffects(heir.lines);
  }
  showEndChoices(nav);
}

function showEndChoices(nav) {
  ui.setChoices([
    { label: 'Prepare the summoning', style: 'primary', onSelect: () => nav.goTo('summon') },
  ]);
}

function lastHistory(state) {
  return state.life.history[state.life.history.length - 1];
}

function logEffects(lines) {
  if (lines.length) ui.log(lines.join(' · '), 'effect');
}

