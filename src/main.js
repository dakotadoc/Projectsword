// Boot and screen routing.
//
// Two kinds of screen:
// - The title menu, which sits outside any run (no state needed).
// - In-run screens, registered in `screens`. The current one is stored in
//   state.screen, so Continue/Import resume exactly where the player was.

import * as ui from './ui.js';
import {
  getState, newState, clearState, saveGame, loadGame, hasSave,
  exportSave, importSave,
} from './state.js';
import { storage } from './storage.js';
import { loadData } from './data.js';
import { birthScreen } from './birth.js';
import { lifeScreen } from './life.js';
import { summonScreen } from './summon.js';
import { chatScreen } from './chat.js';
import { warScreen } from './war.js';
import { battleScreen } from './battle.js';
import { endingScreen } from './ending.js';
import { renderStatus } from './status.js';
import { updateChrome } from './hud.js';
import { icon, medallion, summoningCircle, CLASSES } from './emblems.js';
import { openCustomRun } from './custom.js';
import { openDebug } from './debug.js';

// In-run screens. Each is an async function that writes to the log and sets
// choices. It receives { resumed, goTo, autosave }.
// Later milestones add: the full endgame.
const screens = {
  birth: birthScreen,
  life: lifeScreen,
  summon: summonScreen,
  chat: chatScreen,
  war: warScreen,
  battle: battleScreen,
  ending: endingScreen,
};

// resumed: true re-enters a screen without repeating its intro text (used
// when coming back from a conversation).
async function goTo(name, { resumed = false } = {}) {
  const state = getState();
  if (!screens[name]) throw new Error(`Unknown screen: ${name}`);
  state.screen = name;
  updateChrome(state);
  await screens[name]({ resumed, goTo, autosave });
  await autosave();
}

// Re-enter the saved screen after Continue/Import, without re-running its
// intro text (the log is restored from the save instead).
async function resume() {
  const state = getState();
  ui.showTab('text');
  updateChrome(state);
  ui.renderLog(state.log);
  ui.setSeedLabel(state.rng.seed);
  ui.setGameButtonsEnabled(true);
  ui.log('— Game loaded —', 'system');
  const screen = screens[state.screen];
  if (!screen) {
    ui.log(`This save stopped on a screen this version doesn't have ("${state.screen}").`, 'system');
    return;
  }
  await screen({ resumed: true, goTo, autosave });
}

async function autosave() {
  updateChrome(getState());
  const persisted = await saveGame();
  if (persisted) ui.setStatus('Saved');
  else ui.setStatus('Saving only lasts until you close this page. Use Export to keep your game.', 'warn');
}

// ---- Title menu ----

async function showTitle() {
  clearState();
  ui.showTab('text');
  ui.clearLog();
  ui.setSeedLabel('');
  ui.setGameButtonsEnabled(false);
  ui.setStatus(storage.persistent ? '' : 'This browser blocks saving. Use Export/Import to keep games.', storage.persistent ? '' : 'warn');

  updateChrome(null);
  document.getElementById('log').append(titleHero());

  const saved = await hasSave();
  const choices = [];
  if (saved) choices.push({ label: 'Continue', style: 'primary', onSelect: continueGame });
  choices.push(
    { label: 'New game', style: saved ? '' : 'primary', onSelect: () => startNewGame() },
    { label: 'New game from a seed', onSelect: askForSeed },
    { label: 'Custom run', hint: 'Choose your birth by hand', onSelect: () => openCustomRun(({ seed, custom }) => startNewGame(seed, custom)) },
    { label: 'Import a save', onSelect: openImport },
  );
  ui.setChoices(choices);
}

async function continueGame() {
  try {
    await loadGame();
  } catch (err) {
    ui.showDialog({ title: "Couldn't load", text: err.message });
    return;
  }
  await resume();
}

// custom: choices from the custom run form (custom.js), or undefined.
async function startNewGame(seed, custom) {
  if (await hasSave()) {
    const ok = await ui.confirmDialog(
      'Start a new game?',
      'This replaces your saved game. Export it first if you want to keep it.',
      'Start new game',
    );
    if (!ok) return;
  }
  const state = newState(seed);
  if (custom) state.custom = custom;
  ui.clearLog();
  ui.setSeedLabel(state.rng.seed);
  ui.setGameButtonsEnabled(true);
  await goTo('birth');
}

function askForSeed() {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'dialog-input';
  input.placeholder = 'Any word or number';
  input.setAttribute('aria-label', 'Seed');
  input.maxLength = 64;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.closest('.dialog').querySelector('.choice-primary')?.click();
  });
  ui.showDialog({
    title: 'New game from a seed',
    text: 'The same seed always gives the same run. Useful for replaying a bug.',
    content: input,
    actions: [
      { label: 'Cancel' },
      {
        label: 'Start',
        style: 'primary',
        onSelect: () => {
          const seed = input.value.trim();
          if (!seed) { input.focus(); return false; }
          // Close this dialog first, then start (which may ask to confirm).
          setTimeout(() => startNewGame(seed), 0);
        },
      },
    ],
  });
}

// ---- Debug ----

// After the debug menu changes the run: save, and redraw the summoning
// choices if the catalysts changed there. Other screens read the new values
// the next time they need them; the HUD and Status update on their own.
async function afterDebug() {
  const state = getState();
  await autosave();
  if (state.screen === 'summon' && !state.servant) await goTo('summon', { resumed: true });
}

// ---- Export / import ----

function openExport() {
  const text = exportSave();
  const area = document.createElement('textarea');
  area.className = 'dialog-textarea';
  area.readOnly = true;
  area.value = text;
  area.setAttribute('aria-label', 'Save text');
  const note = document.createElement('p');
  note.className = 'dialog-note';
  note.setAttribute('role', 'status');

  ui.showDialog({
    title: 'Export save',
    text: 'Copy this text and keep it somewhere safe. Paste it into Import to restore this game.',
    content: wrap(area, note),
    actions: [
      { label: 'Close' },
      {
        label: 'Copy',
        style: 'primary',
        onSelect: async () => {
          try {
            await navigator.clipboard.writeText(text);
            note.textContent = 'Copied.';
          } catch {
            area.focus();
            area.select();
            note.textContent = "Couldn't copy automatically. The text is selected: press Ctrl+C (or long-press and Copy).";
          }
          return false; // keep the dialog open
        },
      },
    ],
  });
}

function openImport() {
  const area = document.createElement('textarea');
  area.className = 'dialog-textarea';
  area.placeholder = 'Paste save text here';
  area.setAttribute('aria-label', 'Save text');
  const note = document.createElement('p');
  note.className = 'dialog-note dialog-error';
  note.setAttribute('role', 'alert');

  ui.showDialog({
    title: 'Import save',
    text: 'Paste text from Export. This replaces the game in progress.',
    content: wrap(area, note),
    actions: [
      { label: 'Cancel' },
      {
        label: 'Load',
        style: 'primary',
        onSelect: async () => {
          try {
            importSave(area.value);
          } catch (err) {
            note.textContent = err.message;
            return false;
          }
          await autosave();
          await resume();
        },
      },
    ],
  });
}

function wrap(...nodes) {
  const div = document.createElement('div');
  div.append(...nodes);
  return div;
}

async function returnToTitle() {
  if (getState()) await autosave();
  await showTitle();
}

// ---- Boot ----

function boot() {
  document.getElementById('btn-export').addEventListener('click', openExport);
  document.getElementById('btn-import').addEventListener('click', openImport);
  document.getElementById('btn-title').addEventListener('click', returnToTitle);
  document.getElementById('btn-debug').addEventListener('click', () => openDebug(afterDebug));
  window.addEventListener('error', (e) => ui.setStatus(`Error: ${e.message}`, 'error'));
  window.addEventListener('unhandledrejection', (e) => ui.setStatus(`Error: ${e.reason?.message || e.reason}`, 'error'));
  ui.setupTabs((panel) => renderStatus(panel, getState()));
  const brand = document.getElementById('topbar-title');
  const brandName = document.createElement('span');
  brandName.className = 'topbar-name';
  brandName.textContent = brand.textContent;
  brand.replaceChildren(icon('seal', { size: 22 }), brandName);
  loadData().then(showTitle, showDataError);
}

// The title screen's picture: a slowly turning summoning circle ringed by
// the seven class emblems, with the Command Seal at its heart.
function titleHero() {
  const hero = document.createElement('div');
  hero.className = 'title-hero';
  const art = document.createElement('div');
  art.className = 'title-art';
  const ring = document.createElement('div');
  ring.className = 'title-ring';
  CLASSES.forEach((c, i) => {
    const a = (i / CLASSES.length) * Math.PI * 2 - Math.PI / 2;
    const m = medallion(c, { size: 38 });
    m.style.left = `${50 + Math.cos(a) * 44}%`;
    m.style.top = `${50 + Math.sin(a) * 44}%`;
    ring.append(m);
  });
  art.append(summoningCircle({ size: 290 }), icon('seal', { size: 92, className: 'title-seal' }), ring);
  const name = document.createElement('h1');
  name.className = 'title-name';
  name.textContent = 'Holy Grail War Simulator';
  const tag = document.createElement('p');
  tag.className = 'title-tag';
  tag.textContent = 'Be born. Grow up. Summon a hero. Survive the war. A parody fan game, not affiliated with any official work.';
  hero.append(art, name, tag);
  return hero;
}

// Data files are broken or missing: say exactly what, and stop.
function showDataError(err) {
  ui.clearLog();
  ui.setChoices([]);
  const p = document.createElement('p');
  p.className = 'entry entry-card';
  p.textContent = `The game couldn't start.\n${err.message}`;
  document.getElementById('log').append(p);
  ui.setStatus('Data error', 'error');
}

boot();
