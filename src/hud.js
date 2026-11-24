// The HUD strip under the top bar during the war (day, time, HP, mana,
// Bond), and the page theme that follows the story (phase and time of day).
// Rebuilt from state after every autosave.

import { findById, getData } from './data.js';
import { medallion } from './emblems.js';

const $ = (id) => document.getElementById(id);

export function updateChrome(state) {
  applyTheme(state);
  renderHud(state);
}

// body[data-phase] and body[data-time] drive the background (style.css).
function applyTheme(state) {
  const b = document.body;
  b.dataset.phase = state?.screen || 'title';
  const stage = state?.war?.stage;
  const night = ['dusk', 'night', 'endNight', 'battle', 'finale'].includes(stage) || state?.war?.eventReturn === 'endNight';
  b.dataset.time = state?.war ? (night ? 'night' : 'day') : '';
}

function bar(label, value, max, kind) {
  const row = document.createElement('div');
  row.className = `hud-bar hud-${kind}`;
  const top = document.createElement('div');
  top.className = 'hud-bar-label';
  top.textContent = label;
  const v = document.createElement('span');
  v.className = 'hud-value';
  v.textContent = max ? `${value}/${max}` : String(value);
  const track = document.createElement('div');
  track.className = 'hud-track';
  const fill = document.createElement('div');
  fill.className = 'hud-fill';
  fill.style.width = `${max ? Math.max(0, Math.min(100, (value / max) * 100)) : value}%`;
  track.append(fill);
  row.append(top, track, v);
  return row;
}

function renderHud(state) {
  const hud = $('hud');
  if (!hud) return;
  const inWar = state?.war && ['war', 'battle', 'chat'].includes(state.screen) && state.war.stage !== 'over';
  hud.hidden = !inWar;
  if (!inWar) return;
  hud.replaceChildren();

  const days = getData('rules').war.days;
  const when = document.createElement('div');
  when.className = 'hud-when';
  const day = document.createElement('strong');
  day.textContent = `Day ${Math.min(state.war.day, days)}`;
  const time = document.createElement('span');
  time.textContent = document.body.dataset.time === 'night' ? 'Night' : 'Day';
  when.append(day, time);
  hud.append(when);

  const m = state.master;
  const sv = state.servant;
  if (sv && sv.status !== 'lost') {
    const s = findById('servants', sv.id);
    const who = document.createElement('div');
    who.className = 'hud-servant';
    who.append(medallion(s.class, { size: 26 }));
    hud.append(who, bar(s.name, sv.hp.current, sv.hp.max, 'servant-hp'));
  }
  if (m.hp) hud.append(bar('You', m.hp.current, m.hp.max, 'master'));
  hud.append(bar('Mana', m.mana.current, m.mana.max, 'mana'));
  if (sv && sv.status !== 'lost') hud.append(bar('Bond', sv.bond, 100, 'bond'));
}
