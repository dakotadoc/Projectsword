// Phase 4: The War. Day by day: dawn (recovery and 0–2 war events), a Day
// action, then a Night action. Runs for rules.war.days days.
//
// state.war = {
//   day,                       // 1-based
//   stage,                     // where the day is; see advance()
//   eventQueue: [],            // war events rolled at dawn, still to show
//   eventId, eventReturn,      // event waiting for a choice, and what follows it
//   seenEvents: [], seenRumors: [],
//   workshop: 0,               // base defenses, 0..rules.war.workshop.maxLevel
//   history: [{ day, events: [], dayAction, nightAction, nightEvent }],
// }
//
// Stages: 'dawn' → 'events' → 'day' → 'dusk' → 'night' → (next day) 'dawn',
// with 'eventChoice' when an event waits for the player, 'talk' while the
// Day action is a conversation (still daytime), and 'over' at the end.
// Every transition is saved, so Continue (or coming back from a talk) picks
// up exactly where the day was, without repeating any text.

import * as ui from './ui.js';
import { getState } from './state.js';
import { getData, findById } from './data.js';
import { randInt, chance, weightedPick } from './rng.js';
import { makeContext, fits, pickText, fillText, rollEvent, applyEffects } from './events.js';
import { openChat } from './chat.js';

export async function warScreen({ resumed = false, goTo, autosave }) {
  const state = getState();
  const nav = { goTo, autosave };
  if (!state.war) {
    state.war = {
      day: 1, stage: 'dawn', eventQueue: [], eventId: null, eventReturn: null,
      seenEvents: [], seenRumors: [], workshop: 0, history: [],
    };
    ui.log('The Holy Grail War', 'heading');
    ui.log(pickText(getData('war').intro, warContext(state)));
  }
  void resumed; // stages make re-entry safe; nothing is logged twice
  await advance(state, nav);
}

function warContext(state) {
  return makeContext(state, { age: state.master.warAge, year: state.world.warYear, day: state.war?.day ?? 1 });
}

function rules() {
  return getData('rules').war;
}

function today(state) {
  return state.war.history[state.war.history.length - 1];
}

// Run automatic steps until the player has something to choose.
async function advance(state, nav) {
  const war = state.war;
  for (let guard = 0; guard < 20; guard++) {
    switch (war.stage) {
      case 'dawn':
        startDay(state);
        war.stage = 'events';
        break;
      case 'events': {
        if (!war.eventQueue.length) {
          war.stage = 'day';
          ui.log('What will you do today?', 'system');
          break;
        }
        const waiting = showEvent(state, findById('events', war.eventQueue.shift()), 'events');
        if (waiting) return finish(state, nav);
        break;
      }
      case 'eventChoice':
        showEventChoices(state, findById('events', war.eventId), nav);
        return finish(state, nav, { choicesShown: true });
      case 'day':
        showDayActions(state, nav);
        return finish(state, nav, { choicesShown: true });
      case 'talk':
        war.stage = 'dusk'; // back from the Day-action conversation
        break;
      case 'dusk':
        ui.log('Night', 'heading');
        ui.log(pickText(getData('war').dusk, warContext(state)));
        war.stage = 'night';
        break;
      case 'night':
        showNightActions(state, nav);
        return finish(state, nav, { choicesShown: true });
      case 'endNight':
        war.day += 1;
        war.stage = war.day > rules().days ? 'over' : 'dawn';
        if (war.stage === 'over') {
          ui.log('The End of the War', 'heading');
          ui.log(pickText(getData('war').end, warContext(state)));
        }
        break;
      case 'over':
        showEndChoices(state, nav);
        return finish(state, nav, { choicesShown: true });
      default:
        throw new Error(`Unknown war stage: ${war.stage}`);
    }
  }
  throw new Error('The war loop did not settle.');
}

async function finish(state, nav, { choicesShown = false } = {}) {
  if (!choicesShown && state.war.stage === 'eventChoice') {
    showEventChoices(state, findById('events', state.war.eventId), nav);
  }
  await nav.autosave();
}

// ---- Dawn ----

function startDay(state) {
  const war = state.war;
  const r = rules();
  const ctx = warContext(state);
  war.history.push({ day: war.day, events: [], dayAction: null, nightAction: null, nightEvent: null });

  ui.log(`Day ${war.day} of ${r.days}`, 'heading');
  ui.log(pickText(getData('war').dawn, ctx));

  // Natural recovery overnight.
  const m = state.master;
  const sv = state.servant;
  const lines = applyEffects(state, {
    mana: Math.round(m.mana.max * r.dawnManaRegen),
    servantHp: Math.round(sv.hp.max * r.dawnHpRegen),
  }, ctx);
  if (lines.length) ui.log(lines.join(' · '), 'effect');

  // Roll today's war events now, so the day is fixed by the seed.
  const counts = Object.entries(r.eventsPerDay).map(([n, weight]) => ({ n: Number(n), weight }));
  const count = weightedPick(counts).n;
  const picked = [];
  for (let i = 0; i < count; i++) {
    const e = rollEvent('war', ctx, war.seenEvents, picked);
    if (!e) break;
    picked.push(e.id);
    if (!e.repeatable) war.seenEvents.push(e.id);
  }
  war.eventQueue = picked;
}

// Logs an event. Returns true if it waits for a choice.
function showEvent(state, event, returnTo) {
  const war = state.war;
  const ctx = warContext(state);
  const day = today(state);
  if (event.phase === 'night') day.nightEvent = event.id;
  else day.events.push(event.id);

  ui.log(fillText(event.text, ctx));
  const lines = applyEffects(state, event.effects, ctx);
  if (lines.length) ui.log(lines.join(' · '), 'effect');

  const choices = (event.choices || []).filter((c) => fits(c, warContext(state)));
  if (!choices.length) return false;
  war.stage = 'eventChoice';
  war.eventId = event.id;
  war.eventReturn = returnTo;
  return true;
}

function showEventChoices(state, event, nav) {
  const ctx = warContext(state);
  const choices = (event.choices || []).filter((c) => fits(c, ctx));
  ui.setChoices(choices.map((choice) => ({
    label: fillText(choice.label, ctx),
    onSelect: async () => {
      const war = state.war;
      ui.log(`You chose: ${fillText(choice.label, ctx)}`, 'system');
      if (choice.text) ui.log(fillText(choice.text, ctx));
      const lines = applyEffects(state, choice.effects, ctx);
      if (lines.length) ui.log(lines.join(' · '), 'effect');
      war.stage = war.eventReturn;
      war.eventId = null;
      war.eventReturn = null;
      await advance(state, nav);
    },
  })));
}

// ---- Day actions ----

function showDayActions(state, nav) {
  const ctx = warContext(state);
  const r = rules();
  const war = state.war;
  ui.setChoices(getData('war').dayActions.map((action) => {
    const choice = {
      label: fillText(action.label, ctx),
      hint: fillText(action.hint, ctx),
      onSelect: () => doDayAction(state, action, nav),
    };
    if (action.id === 'workshop') {
      const cost = r.workshop.cost[war.workshop];
      if (war.workshop >= r.workshop.maxLevel) {
        choice.disabled = true;
        choice.hint = `Fully prepared (level ${war.workshop})`;
      } else if (state.master.money < cost) {
        choice.disabled = true;
        choice.hint = `Costs ${cost} money (you have ${state.master.money})`;
      } else {
        choice.hint = `Level ${war.workshop} → ${war.workshop + 1}. Costs ${cost} money`;
      }
    }
    if (action.id === 'talk') choice.style = 'primary';
    return choice;
  }));
}

async function doDayAction(state, action, nav) {
  const war = state.war;
  const r = rules();
  const ctx = warContext(state);
  today(state).dayAction = action.id;

  if (action.id === 'talk') {
    // Talking uses the Day action. The night begins when the talk ends.
    war.stage = 'talk';
    await openChat(nav.goTo, { returnTo: 'war', occasion: `day ${war.day}` });
    return;
  }

  if (action.texts) ui.log(pickText(action.texts, ctx));
  let effects = {};
  if (action.id === 'rest') {
    effects = {
      servantHp: Math.round(state.servant.hp.max * r.rest.hp),
      mana: Math.round(state.master.mana.max * r.rest.mana),
    };
  } else if (action.id === 'train') {
    effects = {
      stats: { body: randInt(...r.train.gain), magecraft: randInt(...r.train.gain) },
      bond: r.train.bond,
    };
  } else if (action.id === 'intel') {
    const rumors = action.rumors.filter((x) => fits(x, ctx) && !war.seenRumors.includes(x.text));
    if (rumors.length) {
      const rumor = weightedPick(rumors);
      war.seenRumors.push(rumor.text);
      ui.log(fillText(rumor.text, ctx));
    } else {
      ui.log(pickText(action.nothing, ctx));
    }
  } else if (action.id === 'workshop') {
    const cost = r.workshop.cost[war.workshop];
    effects = { money: -cost };
    war.workshop += 1;
  }
  const lines = applyEffects(state, effects, ctx);
  if (action.id === 'workshop') lines.push(`Workshop level ${war.workshop}`);
  if (lines.length) ui.log(lines.join(' · '), 'effect');

  war.stage = 'dusk';
  await advance(state, nav);
}

// ---- Night actions ----

function showNightActions(state, nav) {
  const ctx = warContext(state);
  ui.setChoices(getData('war').nightActions.map((action) => {
    const choice = {
      label: fillText(action.label, ctx),
      hint: fillText(action.hint, ctx),
      onSelect: () => doNightAction(state, action, nav),
    };
    if (action.requires && !requirementMet(state, action.requires)) {
      choice.disabled = true;
      choice.hint = action.requires === 'knownMaster'
        ? "You don't know where any rival Master is yet"
        : "You don't know any rival's location yet";
    }
    return choice;
  }));
}

// Scouting and ambushes need intel on a rival (milestone 7).
function requirementMet(state, requirement) {
  const rivals = state.rivals || [];
  if (requirement === 'knownLocation') return rivals.some((rv) => rv.intel?.master >= 1);
  if (requirement === 'knownMaster') return rivals.some((rv) => rv.intel?.master >= 2);
  return true;
}

async function doNightAction(state, action, nav) {
  const war = state.war;
  const r = rules();
  const ctx = warContext(state);
  today(state).nightAction = action.id;
  ui.log(pickText(action.texts, ctx));

  if (action.id === 'patrol') {
    const event = chance(r.patrolEncounterChance) ? rollEvent('night', ctx, war.seenEvents) : null;
    if (event) {
      if (!event.repeatable) war.seenEvents.push(event.id);
      const waiting = showEvent(state, event, 'endNight');
      if (waiting) {
        showEventChoices(state, event, nav);
        await nav.autosave();
        return;
      }
    } else {
      ui.log(pickText(action.quiet, ctx));
    }
  } else if (action.id === 'hide') {
    const lines = applyEffects(state, {
      servantHp: Math.round(state.servant.hp.max * r.hiddenRegen.hp),
      mana: Math.round(state.master.mana.max * r.hiddenRegen.mana),
    }, ctx);
    if (lines.length) ui.log(lines.join(' · '), 'effect');
  }
  war.stage = 'endNight';
  await advance(state, nav);
}

// ---- End (placeholder until milestone 11) ----

function showEndChoices(state, nav) {
  const name = findById('servants', state.servant.id).name;
  ui.setChoices([
    { label: `Talk with ${name}`, onSelect: () => openChat(nav.goTo, { returnTo: 'war', occasion: 'after the war' }) },
  ]);
}

// For the Status tab and the AI context.
export function timeOfDay(state) {
  const stage = state.war?.stage;
  if (!stage) return null;
  if (stage === 'over') return 'The war is over';
  if (stage === 'night' || stage === 'dusk' || stage === 'endNight') return 'Night';
  if (stage === 'eventChoice') return state.war.eventReturn === 'endNight' ? 'Night' : 'Day';
  return 'Day';
}
