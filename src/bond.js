// Bond effects that show up in the story (milestone 10):
// - the Servant speaking up after big moments (an AI-written line, with a
//   prepared fallback from dialogue.json),
// - Bond milestones (40 and 80) that the Servant notices,
// - the platonic / romantic path chosen at Bond 60.
// Combat bonuses from Bond live in combat.js (bondTier).
//
// state.servant.path = null | 'platonic' | 'romantic'
// state.servant.bondMilestones = [40, …]   (milestones already marked)

import * as ui from './ui.js';
import { getData } from './data.js';
import { getServantRemark, currentServant } from './servantTalk.js';

function servantHere(state) {
  return Boolean(state.servant) && state.servant.status !== 'lost';
}

// Show a Servant's line, streaming in, labeled with their name.
export async function sayRemark(state, moment, detail = '') {
  if (!servantHere(state)) return;
  const name = currentServant(state).name;
  const entry = ui.beginEntry('speech');
  const { text } = await getServantRemark(state, moment, {
    detail,
    onText: (t) => entry.update(`${name}: “${t}”`),
  });
  entry.commit(`${name}: “${text}”`);
}

// A Bond milestone the Servant should remark on, or null. Marks it as done.
export function nextBondMilestone(state) {
  if (!servantHere(state)) return null;
  const sv = state.servant;
  sv.bondMilestones ??= [];
  const m = getData('rules').bond.milestones.find((x) => sv.bond >= x && !sv.bondMilestones.includes(x));
  if (m === undefined) return null;
  sv.bondMilestones.push(m);
  return m;
}

export function needsPathChoice(state) {
  return servantHere(state) && !state.servant.path && state.servant.bond >= getData('rules').bond.pathAt;
}

// Ask the player how they see their Servant. onDone runs after the choice
// and the Servant's reaction.
export function showPathChoice(state, onDone) {
  const t = getData('dialogue').pathChoice;
  const name = currentServant(state).name;
  ui.log(t.prompt.replaceAll('{servant}', name), 'system');
  const choose = async (path, label) => {
    state.servant.path = path;
    ui.log(`You chose: ${label}`, 'system');
    await sayRemark(state, path === 'romantic' ? 'pathRomantic' : 'pathPlatonic');
    ui.log(path === 'romantic' ? `You and ${name} are in love.` : `${name} is your closest comrade.`, 'effect');
    await onDone();
  };
  ui.setChoices([
    { label: t.platonic, hint: t.platonicHint, onSelect: () => choose('platonic', t.platonic) },
    { label: t.romantic, hint: t.romanticHint, onSelect: () => choose('romantic', t.romantic) },
  ]);
}

export function pathLabel(path) {
  return path === 'romantic' ? 'Lovers' : path === 'platonic' ? 'Closest comrades' : 'Not yet decided';
}
