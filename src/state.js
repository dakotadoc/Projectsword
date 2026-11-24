// The single game-state object, plus save / load / export / import.
//
// Everything about a run lives in `state` and must be plain JSON
// (no functions, classes, Maps, or DOM nodes), so it can be saved as text.

import { bindRng, createRngState, makeSeed } from './rng.js';
import { storage } from './storage.js';

export const SAVE_VERSION = 4;
// Saves older than this are from test builds and can't be continued.
const OLDEST_SUPPORTED_VERSION = 3;
const SAVE_KEY = 'hgws.save';
const LOG_LIMIT = 300; // keep the saved log from growing forever

let state = null;

export function getState() {
  return state;
}

export function newState(seed = makeSeed()) {
  state = {
    version: SAVE_VERSION,
    createdAt: new Date().toISOString(),
    updatedAt: null,
    rng: createRngState(seed),
    screen: null, // current in-run screen name (see main.js)
    log: [], // [{ text, kind }] — the narration shown on screen
    world: null, // { placeId, eraId, warYear } — set at birth (birth.js)
    master: null, // the player character — set at birth (birth.js)
    servant: null, // the summoned Servant — set at summoning (summon.js)
    // Later milestones add: life, servant, war, rivals, intel, chat...
  };
  bindRng(state.rng);
  return state;
}

export function clearState() {
  state = null;
  bindRng(null);
}

export function addLogEntry(text, kind) {
  if (!state) return;
  state.log.push({ text, kind });
  if (state.log.length > LOG_LIMIT) state.log.splice(0, state.log.length - LOG_LIMIT);
}

// ---- Save / load (autosave slot) ----

// Returns true if saved persistently, false if only for this session.
export async function saveGame() {
  if (!state) return false;
  state.updatedAt = new Date().toISOString();
  return storage.set(SAVE_KEY, JSON.stringify(state));
}

export async function hasSave() {
  return (await storage.get(SAVE_KEY)) !== null;
}

// Loads the autosave into `state`. Throws an Error with a readable message
// if the save is broken.
export async function loadGame() {
  const text = await storage.get(SAVE_KEY);
  if (text === null) throw new Error('There is no saved game.');
  useState(parseSave(text));
  return state;
}

export async function deleteSave() {
  await storage.remove(SAVE_KEY);
}

// ---- Export / import (copy-paste JSON text) ----

export function exportSave() {
  return state ? JSON.stringify(state) : '';
}

// Replaces `state` with the pasted save. Throws a readable Error if invalid.
export function importSave(text) {
  useState(parseSave(text));
  return state;
}

// Upgrade an older save to the current shape, one version at a time.
function migrate(data) {
  if (data.version === 3) {
    // Milestone 4 replaced the placeholder catalysts with one per Servant.
    const renamed = {
      rusted_hilt: 'round_table_splinter',
      temple_bell_shard: 'lapis_cylinder_seal',
      cracked_vial: 'solomon_signet',
      ivory_die: 'cleopatra_pearl',
      obsidian_arrowhead: 'donkey_jawbone',
    };
    if (Array.isArray(data.master?.catalysts)) {
      data.master.catalysts = data.master.catalysts.map((id) => renamed[id] ?? id);
    }
    data.servant ??= null;
    data.version = 4;
  }
}

function useState(next) {
  state = next;
  bindRng(state.rng);
}

function parseSave(text) {
  let data;
  try {
    data = JSON.parse(String(text).trim());
  } catch {
    throw new Error("That isn't valid save text. Paste the whole thing from Export.");
  }
  if (!data || typeof data !== 'object' || typeof data.version !== 'number') {
    throw new Error("That text doesn't look like a save from this game.");
  }
  if (data.version > SAVE_VERSION) {
    throw new Error('That save is from a newer version of the game.');
  }
  if (data.version < OLDEST_SUPPORTED_VERSION) {
    throw new Error('That save is from an older test build of the game and can no longer be continued. Please start a new game.');
  }
  migrate(data);
  const ok =
    data.rng && typeof data.rng.s === 'number' && typeof data.rng.seed === 'string' &&
    Array.isArray(data.log) &&
    (data.screen === null || typeof data.screen === 'string');
  if (!ok) throw new Error('That save is damaged or incomplete.');
  return data;
}
