// Game over: a short epilogue. state.ending = { type } where type is
// 'church' (fled and made it), 'churchKilled' (fled and didn't) or
// 'masterDied'. Milestone 11 adds the full ending and run summary.

import * as ui from './ui.js';
import { getState } from './state.js';
import { getData } from './data.js';
import { makeContext, pickText } from './events.js';

const HEADINGS = { church: 'Sanctuary', churchKilled: 'So Close', masterDied: 'The End' };

export async function endingScreen({ resumed = false }) {
  const state = getState();
  const type = state.ending.type;
  if (!resumed) {
    const ctx = makeContext(state, { age: state.master.warAge, year: state.world.warYear, day: state.war?.day });
    ui.log('Epilogue', 'heading');
    ui.log(HEADINGS[type] || '', 'system');
    ui.log(pickText(getData('combat').epilogues[type], ctx));
    ui.log('Your war is over. (The full ending and run summary are still to come.)', 'system');
  }
  ui.setChoices([
    { label: 'Return to title', style: 'primary', onSelect: () => document.getElementById('btn-title').click() },
  ]);
}
