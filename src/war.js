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
//   history: [{ day, events: [], dayAction, nightAction, nightTarget, nightEvent }],
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
import { generateRivals, activeRivals } from './rivals.js';
import { gainIntel, gainRandomIntel, gatherChance, contactTip, rivalLabel } from './intel.js';

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
  // Rivals are created once per war (also for saves that began the war
  // before rivals existed).
  if (!state.rivals) generateRivals(state);
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
  logOutcome(lines);

  // A contact may bring a tip.
  const tip = contactTip(state);
  if (tip) {
    ui.log(pickText(getData('war').contactTip, ctx));
    logOutcome(Object.assign([], { intel: [tip] }));
  }

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
  logOutcome(lines);

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
      logOutcome(lines);
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
    // A Mind/contacts check. Success teaches something real about a rival
    // (up to level 2); failure still turns up a rumor for flavor.
    const learned = chance(gatherChance(state)) ? gainRandomIntel(state, { max: 2 }) : null;
    if (learned) {
      effects.intelTexts = [learned];
    } else if (!activeRivals(state).some((rv) => rv.intel.master < 2 || rv.intel.servant < 2)) {
      ui.log(pickText(action.maxed, ctx));
    } else {
      const rumors = action.rumors.filter((x) => fits(x, ctx) && !war.seenRumors.includes(x.text));
      if (rumors.length) {
        const rumor = weightedPick(rumors);
        war.seenRumors.push(rumor.text);
        ui.log(fillText(rumor.text, ctx));
      } else {
        ui.log(pickText(action.nothing, ctx));
      }
    }
  } else if (action.id === 'workshop') {
    const cost = r.workshop.cost[war.workshop];
    effects = { money: -cost };
    war.workshop += 1;
  }
  const { intelTexts = [], ...rest } = effects;
  const lines = applyEffects(state, rest, ctx);
  lines.intel.push(...intelTexts);
  if (action.id === 'workshop') lines.push(`Workshop level ${war.workshop}`);
  logOutcome(lines);

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
      onSelect: () => (action.requires ? showTargets(state, action, nav) : doNightAction(state, action, nav)),
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

// Scouting needs a rival's rough location (Master intel 1); an ambush needs
// their base (Master intel 2).
function targetsFor(state, requirement) {
  const min = requirement === 'knownMaster' ? 2 : 1;
  return activeRivals(state).filter((rv) => rv.intel.master >= min);
}

function requirementMet(state, requirement) {
  return targetsFor(state, requirement).length > 0;
}

// Pick which rival to scout or ambush. (Not saved: a reload goes back to
// the night's main choices.)
function showTargets(state, action, nav) {
  const choices = targetsFor(state, action.requires).map((rival) => ({
    label: capitalize(rivalLabel(rival)),
    hint: action.requires === 'knownMaster' ? `Base: ${rival.master.base}, ${rival.master.district}` : `Seen around ${rival.master.district}`,
    onSelect: () => doNightAction(state, action, nav, rival),
  }));
  choices.push({ label: 'Back', onSelect: () => showNightActions(state, nav) });
  ui.setChoices(choices);
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// Text with the target rival's details filled in.
function targetText(variants, ctx, rival) {
  return pickText(variants, ctx)
    .replaceAll('{label}', rivalLabel(rival))
    .replaceAll('{district}', rival.master.district)
    .replaceAll('{base}', rival.master.base);
}

async function doNightAction(state, action, nav, target = null) {
  const war = state.war;
  const r = rules();
  const ctx = warContext(state);
  today(state).nightAction = action.id;
  if (target) today(state).nightTarget = target.id;
  ui.log(target ? targetText(action.texts, ctx, target) : pickText(action.texts, ctx));

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
  } else if (action.id === 'scout') {
    scout(state, action, target, ctx);
  } else if (action.id === 'ambush') {
    // Battles arrive in milestone 8. Until then an ambush ends in a
    // standoff, which at least shows you their Servant.
    ui.log(targetText(action.standoff, ctx, target));
    ui.log('(Battles are not in the game yet. For now, an ambush ends in a standoff.)', 'system');
    const text = gainIntel(state, target, 'servant');
    logOutcome(Object.assign([], { intel: text ? [text] : [] }));
  } else if (action.id === 'hide') {
    const lines = applyEffects(state, {
      servantHp: Math.round(state.servant.hp.max * r.hiddenRegen.hp),
      mana: Math.round(state.master.mana.max * r.hiddenRegen.mana),
    }, ctx);
    logOutcome(lines);
  }
  war.stage = 'endNight';
  await advance(state, nav);
}

// Scouting: risk being spotted (likelier with an aggressive rival).
// Unspotted, you learn one level about both the Master and the Servant,
// and only scouting can reach level 3.
function scout(state, action, target, ctx) {
  const ir = getData('rules').intel;
  const spotted = chance(ir.scoutSpotBase + ir.scoutSpotPerAggression * target.master.aggression);
  const learned = [];
  if (spotted) {
    ui.log(targetText(action.spotted, ctx, target));
    const lines = applyEffects(state, { servantHp: -randInt(...ir.scoutSpotHpLoss) }, ctx);
    const glimpse = gainIntel(state, target, 'servant');
    if (glimpse) learned.push(glimpse);
    lines.intel.push(...learned);
    logOutcome(lines);
    return;
  }
  ui.log(targetText(action.success, ctx, target));
  for (const track of ['master', 'servant']) {
    const text = gainIntel(state, target, track);
    if (text) learned.push(text);
  }
  if (!learned.length) ui.log(targetText(action.nothingNew, ctx, target));
  logOutcome(Object.assign([], { intel: learned }));
}

// Log what changed: the "Body +2" style line, then any new intel as story,
// each followed by a short "New intel" marker.
function logOutcome(lines) {
  if (lines.length) ui.log(lines.join(' · '), 'effect');
  for (const text of lines.intel || []) {
    ui.log(text);
    ui.log('New intel. See the Status tab.', 'effect');
  }
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
