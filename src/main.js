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
import { randInt } from './rng.js';

// In-run screens. Each is an async function that writes to the log and sets
// choices. Later milestones add: birth, life, summon, war, combat, ending.
const screens = {
  sandbox: sandboxScreen,
};

export async function goTo(name) {
  const state = getState();
  if (!screens[name]) throw new Error(`Unknown screen: ${name}`);
  state.screen = name;
  await screens[name]();
  await autosave();
}

// Re-enter the saved screen after Continue/Import, without re-running its
// intro text (the log is restored from the save instead).
async function resume() {
  const state = getState();
  ui.renderLog(state.log);
  ui.setSeedLabel(state.rng.seed);
  ui.setGameButtonsEnabled(true);
  ui.log('— Game loaded —', 'system');
  const screen = screens[state.screen] || sandboxScreen;
  await screen({ resumed: true });
}

async function autosave() {
  const persisted = await saveGame();
  if (persisted) ui.setStatus('Saved');
  else ui.setStatus('Saving only lasts until you close this page. Use Export to keep your game.', 'warn');
}

// ---- Title menu ----

async function showTitle() {
  clearState();
  ui.clearLog();
  ui.setSeedLabel('');
  ui.setGameButtonsEnabled(false);
  ui.setStatus(storage.persistent ? '' : 'This browser blocks saving. Use Export/Import to keep games.', storage.persistent ? '' : 'warn');

  const title = document.createElement('p');
  title.className = 'entry entry-heading';
  title.textContent = 'Holy Grail War Simulator';
  const sub = document.createElement('p');
  sub.className = 'entry entry-system';
  sub.textContent = 'A parody fan game. Not affiliated with any official work.';
  document.getElementById('log').append(title, sub);

  const saved = await hasSave();
  const choices = [];
  if (saved) choices.push({ label: 'Continue', style: 'primary', onSelect: continueGame });
  choices.push(
    { label: 'New game', style: saved ? '' : 'primary', onSelect: () => startNewGame() },
    { label: 'New game from a seed', onSelect: askForSeed },
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

async function startNewGame(seed) {
  if (await hasSave()) {
    const ok = await ui.confirmDialog(
      'Start a new game?',
      'This replaces your saved game. Export it first if you want to keep it.',
      'Start new game',
    );
    if (!ok) return;
  }
  const state = newState(seed);
  ui.clearLog();
  ui.setSeedLabel(state.rng.seed);
  ui.setGameButtonsEnabled(true);
  // Milestone 2 replaces this with the birth screen.
  await goTo('sandbox');
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

// ---- Temporary test screen (milestone 1 only) ----
// Exercises the log, choices, seeded RNG and saving. Replaced by the birth
// screen in milestone 2.

async function sandboxScreen({ resumed = false } = {}) {
  const state = getState();
  if (!resumed) {
    ui.log('Skeleton test', 'heading');
    ui.log('This screen only exists to test the skeleton: rolls come from the seeded RNG, and every action autosaves.', 'system');
  }
  ui.setChoices([
    { label: 'Roll a d100', style: 'primary', onSelect: () => roll(() => `d100: ${randInt(1, 100)}`) },
    { label: 'Roll 3d6', onSelect: () => roll(() => {
      const dice = [randInt(1, 6), randInt(1, 6), randInt(1, 6)];
      return `3d6: ${dice.join(' + ')} = ${dice[0] + dice[1] + dice[2]}`;
    }) },
    { label: 'Replay this seed', hint: 'Restart with the same rolls', onSelect: async () => {
      const ok = await ui.confirmDialog('Replay this seed?', `Restarts the run with seed ${state.rng.seed}. Your rolls should repeat exactly.`, 'Replay');
      if (!ok) return;
      newState(state.rng.seed);
      ui.clearLog();
      await goTo('sandbox');
    } },
  ]);
}

async function roll(makeText) {
  ui.log(makeText(), 'roll');
  await autosave();
}

// ---- Boot ----

function boot() {
  document.getElementById('btn-export').addEventListener('click', openExport);
  document.getElementById('btn-import').addEventListener('click', openImport);
  document.getElementById('btn-title').addEventListener('click', returnToTitle);
  window.addEventListener('error', (e) => ui.setStatus(`Error: ${e.message}`, 'error'));
  window.addEventListener('unhandledrejection', (e) => ui.setStatus(`Error: ${e.reason?.message || e.reason}`, 'error'));
  showTitle();
}

boot();
