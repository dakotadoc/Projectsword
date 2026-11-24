// The run summary shown at the end of every game (milestone 11).
// The war is over, so it also reveals who every rival really was.

import { makeContext, fillText } from './events.js';
import { getData, findById } from './data.js';
import { bondBand } from './servantTalk.js';
import { pathLabel } from './bond.js';

export function buildSummary(state) {
  const m = state.master;
  const place = findById('places', state.world.placeId);
  const family = findById('families', m.familyId);
  const trait = findById('traits', m.traitId);
  const t = getData('endings').summary;
  const war = state.war;
  const days = getData('rules').war.days;
  const lines = ['Your war'];
  if (state.custom || state.debugUsed) {
    const note = [state.custom ? 'a custom run' : null, state.debugUsed ? 'edited with the debug menu' : null].filter(Boolean).join(', ');
    lines.push(`${note.charAt(0).toUpperCase()}${note.slice(1)}.`);
  }

  // Life
  lines.push(`${m.name}, born in ${place.name}, ${place.country}, in ${m.birthYear}. ${family.name}. Trait: ${trait.name}.`);
  const highlights = (state.life?.history || []).filter((h) => h.eventId).slice(0, 3).map((h) => {
    const e = findById('events', h.eventId);
    const ctx = makeContext(state, { age: h.age, year: m.birthYear + h.age });
    return `age ${h.age}: ${fillText(e.text, ctx).split(/(?<=[.!?])\s/)[0].replace(/[.!?]$/, '')}`;
  });
  if (highlights.length) lines.push(`Childhood: ${highlights.join('; ')}.`);
  if (m.family?.heir === true) lines.push("Chosen as the family's heir, and given its catalyst.");
  if (m.family?.heir === false) lines.push(m.family.sibling?.rival ? `Passed over as heir in favour of ${m.family.sibling.name}.` : 'Passed over as heir.');
  lines.push(`Stats at the end: Body ${m.stats.body} · Magecraft ${m.stats.magecraft} · Mind ${m.stats.mind} · Charisma ${m.stats.charisma}`);
  lines.push('');

  // Servant
  if (state.servant) {
    const s = findById('servants', state.servant.id);
    const sv = state.servant;
    const fate = sv.status === 'lost' ? `, lost on day ${sv.lostDay ?? '?'}` : '';
    lines.push(`Servant: ${s.class} ${s.trueName}${fate}`);
    lines.push(`Final Bond: ${sv.bond}/100 (${bondBand(sv.bond, sv.path).label}) · Relationship: ${pathLabel(sv.path)}`);
  }

  // War
  if (war) {
    const battles = war.history.filter((h) => h.battle);
    const won = battles.filter((h) => h.battle.outcome === 'won').length;
    lines.push(`Days survived: ${Math.min(war.day, days)} of ${days}`);
    lines.push(`Battles fought: ${battles.length} · won: ${won}`);
    const seals = 3 - (m.commandSeals ?? 3);
    lines.push(`Command Seals used: ${seals} of 3`);
    const learned = (state.rivals || []).filter((r) => r.intel.servant >= 3).length;
    lines.push(`True names learned: ${learned} of ${(state.rivals || []).length}`);
  }

  // Ending
  const ending = state.ending || {};
  const wish = ending.wishKind ? ` · ${t.wishLabels[ending.wishKind]}` : '';
  lines.push(`Ending: ${t.titles[ending.type] || ending.type}${wish}`);

  // Every rival, revealed
  if (state.rivals?.length) {
    lines.push('', 'The other Masters, revealed');
    for (const r of state.rivals) {
      const s = findById('servants', r.servant.id);
      const kin = r.sibling ? ` (your ${r.master.sex === 'female' ? 'sister' : 'brother'})` : '';
      lines.push(`• ${r.master.name}${kin} and ${s.class} ${s.trueName}: ${rivalFate(state, r)}`);
    }
  }
  return lines.join('\n');
}

function rivalFate(state, r) {
  if (r.status === 'active') return state.ending?.type === 'victory' ? 'defeated in the end' : 'still fighting';
  const e = r.eliminated || {};
  if (e.by === 'player') return `defeated by you on day ${e.day}`;
  const by = state.rivals.find((x) => x.id === e.by);
  return by ? `defeated by ${by.master.name} on day ${e.day}` : `out of the war on day ${e.day ?? '?'}`;
}
