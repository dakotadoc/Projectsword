// Phase 3: Summoning. The player picks one of their catalysts (or none);
// a catalyst calls its Servant, and with no catalyst the Grail picks the
// Servant most compatible with the Master ("compatibility summon").
//
// state.servant = {
//   id, catalystId (or null), method: 'catalyst' | 'compatibility',
//   hp: { current, max }, bond, memories: []
// }

import * as ui from './ui.js';
import { getState } from './state.js';
import { getData, findById } from './data.js';
import { weightedPick } from './rng.js';
import { makeContext, pickText } from './events.js';
import { STAT_LABELS } from './ranks.js';
import { openChat } from './chat.js';
import { playScene } from './fx.js';

export async function summonScreen({ resumed = false, goTo, autosave }) {
  const state = getState();
  if (state.servant) {
    showContinue(goTo);
    return;
  }
  const ctx = summonContext(state);
  if (!resumed) {
    ui.log('The Summoning', 'heading');
    ui.log(pickText(getData('summon').intro, ctx));
  }

  const owned = state.master.catalysts.map((id) => findById('catalysts', id));
  const choices = owned.map((catalyst) => ({
    label: `Use the ${lowerFirst(catalyst.name)}`,
    hint: catalyst.description,
    onSelect: () => doSummon(state, catalyst, { goTo, autosave }),
  }));
  choices.push({
    label: owned.length ? 'Summon without a catalyst' : 'Begin the ritual',
    hint: 'The Grail will choose a hero who suits you',
    onSelect: () => doSummon(state, null, { goTo, autosave }),
  });
  ui.setChoices(choices);
}

function summonContext(state) {
  return makeContext(state, { age: state.master.warAge, year: state.world.warYear });
}

async function doSummon(state, catalyst, { goTo, autosave }) {
  const ctx = summonContext(state);
  const texts = getData('summon');
  const rules = getData('rules').summon;

  if (catalyst) {
    ui.log(pickText(texts.withCatalyst, ctx).replaceAll('{catalyst}', lowerFirst(catalyst.name)));
  } else {
    ui.log(pickText(texts.withoutCatalyst, ctx));
  }

  // A catalyst limits the candidates; compatibility decides among them.
  const candidates = catalyst
    ? catalyst.servants.map((id) => findById('servants', id))
    : getData('servants');
  const servant = pickByCompatibility(state, candidates);

  state.servant = {
    id: servant.id,
    catalystId: catalyst ? catalyst.id : null,
    method: catalyst ? 'catalyst' : 'compatibility',
    hp: { current: servant.hp, max: servant.hp },
    bond: rules.startingBond + (catalyst ? 0 : rules.compatibilityBondBonus),
    mood: null,
    memories: [], // [{ occasion, text }] summaries of past conversations
    chatHistory: [], // the last few chat messages, across conversations
    talkedAfterSummon: false,
  };

  await ui.afterTyping();
  await playScene('summon', { cls: servant.class, name: servant.trueName });
  ui.log(servant.summonText);
  if (!catalyst) ui.log(pickText(texts.compatibilityNote, ctx), 'system');
  ui.log(profileText(state.servant, servant), 'card', { emblem: servant.class });
  ui.log(`“${servant.firstLine}”`, 'speech', { emblem: servant.class });
  showContinue(goTo);
  await autosave();
}

// How well a Servant suits this Master. Higher is better.
export function compatibilityScore(state, servant) {
  const m = state.master;
  const c = servant.compatibility || {};
  // Weighted average of the stats this Servant cares about, so a Servant
  // with more (or bigger) weights doesn't win more often just for that.
  const weights = Object.entries(c.stats || {});
  const total = weights.reduce((sum, [, w]) => sum + w, 0);
  let score = 0;
  if (total > 0) {
    for (const [stat, weight] of weights) score += ((m.stats[stat] ?? 0) * weight) / total;
  }
  score += c.traits?.[m.traitId] ?? 0;
  score += c.families?.[m.familyId] ?? 0;
  return score;
}

// Weighted pick that strongly favors the best match but isn't certain.
export function pickByCompatibility(state, candidates) {
  if (candidates.length === 1) return candidates[0];
  const temperature = getData('rules').summon.compatibilityTemperature;
  const scored = candidates.map((s) => ({ s, score: compatibilityScore(state, s) }));
  const best = Math.max(...scored.map((x) => x.score));
  return weightedPick(scored, (x) => Math.exp((x.score - best) / temperature)).s;
}

// The Servant's profile as the Master sees it (they know the true name).
export function profileText(servantState, servant) {
  const st = servant.stats;
  const np = servant.noblePhantasm;
  return [
    'Servant profile',
    `True name: ${servant.trueName}`,
    `Class: ${servant.class}, "${servant.title}"`,
    `Origin: ${servant.origin}`,
    Object.keys(STAT_LABELS).map((k) => `${STAT_LABELS[k]} ${st[k]}`).join(' · '),
    `HP ${servantState.hp.max} · Bond ${servantState.bond}`,
    '',
    'Skills',
    ...servant.skills.map((sk) => `• ${sk.name} (${sk.rank}): ${sk.description}`),
    '',
    `Noble Phantasm: ${np.name} (${np.rank}, ${np.type})`,
    np.description,
    '',
    `Weakness: ${servant.weakness}`,
  ].join('\n');
}

// "Stone from the walls of Constantinople" → "stone from the walls of
// Constantinople", for use mid-sentence.
function lowerFirst(text) {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

// After the summoning, the Master gets one free conversation (a major event).
function showContinue(goTo) {
  const state = getState();
  const choices = [];
  if (!state.servant.talkedAfterSummon) {
    choices.push({
      label: `Talk with ${findById('servants', state.servant.id).name}`,
      hint: 'Get to know your Servant before the war begins',
      onSelect: () => {
        state.servant.talkedAfterSummon = true;
        return openChat(goTo, { returnTo: 'summon', occasion: 'just after the summoning' });
      },
    });
  }
  choices.push({ label: 'The war begins', style: 'primary', onSelect: () => goTo('war') });
  ui.setChoices(choices);
}
