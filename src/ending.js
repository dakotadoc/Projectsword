// The end of a run (milestone 11).
//
// state.ending = {
//   type: 'victory' | 'church' | 'churchKilled' | 'masterDied',
//   stage: 'grail' | 'wish' | 'writing' | 'epilogue' | 'summary' | 'done',
//   talked,                    // the last talk before the wish is used
//   wishKind: 'own' | 'servant' | 'stay' | 'destroy', wishText,
// }
//
// Victory: the Grail appears, an optional last talk with the Servant, the
// wish, an AI-written epilogue, then the run summary. Other endings: a
// short epilogue, then the run summary. Every stage is saved.

import * as ui from './ui.js';
import { getState } from './state.js';
import { getData, findById } from './data.js';
import { makeContext, pickText, fillText } from './events.js';
import { getEpilogue } from './servantTalk.js';
import { openChat } from './chat.js';
import { buildSummary } from './summary.js';

const HEADINGS = { church: 'Sanctuary', churchKilled: 'So Close', masterDied: 'The End', victory: 'The Grail' };

export async function endingScreen({ goTo, autosave }) {
  const state = getState();
  const e = state.ending;
  e.stage ??= e.type === 'victory' ? 'grail' : 'epilogue';
  const nav = { goTo, autosave };
  await advance(state, nav);
}

function ctxOf(state) {
  return makeContext(state, { age: state.master.warAge, year: state.world.warYear, day: state.war?.day });
}

function hasServant(state) {
  return Boolean(state.servant) && state.servant.status !== 'lost';
}

async function advance(state, nav) {
  const e = state.ending;
  for (let guard = 0; guard < 10; guard++) {
    switch (e.stage) {
      case 'grail':
        ui.log('The Grail', 'heading');
        ui.log(pickText(getData('endings').grailAppears, ctxOf(state)));
        ui.log(getData('endings').wishPrompt, 'system');
        e.stage = 'wish';
        await nav.autosave();
        break;
      case 'wish':
        showWishes(state, nav);
        return;
      case 'writing':
        await writeEpilogue(state);
        e.stage = 'summary';
        await nav.autosave();
        break;
      case 'epilogue': {
        ui.log('Epilogue', 'heading');
        ui.log(HEADINGS[e.type] || '', 'system');
        ui.log(pickText(getData('combat').epilogues[e.type], ctxOf(state)));
        e.stage = 'summary';
        await nav.autosave();
        break;
      }
      case 'summary':
        ui.log('Run summary', 'heading');
        ui.log(buildSummary(state), 'card');
        e.stage = 'done';
        await nav.autosave();
        break;
      case 'done':
        ui.setChoices([
          { label: 'Return to title', style: 'primary', onSelect: () => document.getElementById('btn-title').click() },
        ]);
        return;
      default:
        throw new Error(`Unknown ending stage: ${e.stage}`);
    }
  }
}

// ---- The wish ----

function stayUnlocked(state) {
  if (!hasServant(state)) return false;
  const sv = state.servant;
  return sv.path === 'romantic' || (sv.path === 'platonic' && sv.bond >= 80);
}

function showWishes(state, nav) {
  const e = state.ending;
  const c = getData('endings').choices;
  const name = hasServant(state) ? findById('servants', state.servant.id).name : '';
  const fill = (t) => t.replaceAll('{servant}', name);
  const choices = [];
  if (hasServant(state) && !e.talked) {
    choices.push({
      label: fill(c.talk), hint: c.talkHint,
      onSelect: async () => {
        e.talked = true;
        await openChat(nav.goTo, { returnTo: 'ending', occasion: 'at the end of the war, before the wish' });
      },
    });
  }
  choices.push({ label: c.own, hint: c.ownHint, onSelect: () => askOwnWish(state, nav) });
  if (hasServant(state)) choices.push({ label: fill(c.servant), hint: c.servantHint, onSelect: () => wish(state, nav, 'servant') });
  if (stayUnlocked(state)) {
    choices.push({
      label: fill(c.stay), style: 'primary',
      hint: state.servant.path === 'romantic' ? c.stayHintRomantic : c.stayHintPlatonic,
      onSelect: () => wish(state, nav, 'stay'),
    });
  }
  choices.push({ label: c.destroy, hint: c.destroyHint, onSelect: () => wish(state, nav, 'destroy') });
  ui.setChoices(choices);
}

function askOwnWish(state, nav) {
  const c = getData('endings').choices;
  ui.setChatInput({
    placeholder: c.ownPlaceholder,
    maxLength: 200,
    endLabel: 'Back',
    onSend: async (text) => {
      ui.log(`You wish: “${text}”`, 'player');
      await wish(state, nav, 'own', text);
    },
    onEnd: async () => showWishes(state, nav),
  });
}

async function wish(state, nav, kind, text = '') {
  const e = state.ending;
  e.wishKind = kind;
  e.wishText = text;
  e.stage = 'writing';
  await nav.autosave();
  await advance(state, nav);
}

async function writeEpilogue(state) {
  const e = state.ending;
  ui.setChoices([]); // nothing to click while the ending is written
  ui.log('Epilogue', 'heading');
  const entry = ui.beginEntry('narration', 'The light swallows everything…');
  const text = await getEpilogue(state, {
    kind: e.wishKind,
    wishText: e.wishText,
    fallback: () => fallbackEpilogue(state),
    onText: (t) => entry.update(t),
  });
  entry.commit(text);
}

// The prepared epilogue for this wish, Bond and path.
function fallbackEpilogue(state) {
  const e = state.ending;
  const list = getData('endings').fallback[e.wishKind];
  let pickd;
  if (e.wishKind === 'stay') {
    pickd = list.find((x) => x.path === state.servant.path) || list[0];
  } else {
    const tier = !hasServant(state) ? 'none' : state.servant.bond >= 60 ? 'high' : 'low';
    pickd = list.find((x) => x.bond === tier) || list.find((x) => x.bond === 'low') || list[0];
  }
  const servant = state.servant ? findById('servants', state.servant.id) : null;
  const female = servant?.sex === 'female';
  return fillText(pickd.text, ctxOf(state))
    .replaceAll('{servant}', servant?.name || '')
    .replaceAll('{their}', female ? 'her' : 'his')
    .replaceAll('{them}', female ? 'her' : 'him');
}
