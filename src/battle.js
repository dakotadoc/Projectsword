// The battle screen. combat.js decides what happens; this file shows it
// and asks the player for orders, one round at a time.
//
// Each round: a status card, then the Servant's order, then the Master's
// action (with Back), then the round resolves. Every step is saved, so a
// reload mid-battle picks up exactly where it was.

import * as ui from './ui.js';
import { getState } from './state.js';
import { getData, findById } from './data.js';
import { chance } from './rng.js';
import {
  servantOptions, masterOptions, SEAL_OPTIONS, resolveRound, hasServant,
  battleRival, churchSave, startBattle,
} from './combat.js';

export async function battleScreen({ goTo, autosave }) {
  const state = getState();
  const nav = { goTo, autosave };
  render(state, nav);
}

function render(state, nav) {
  const b = state.battle;
  if (b.step === 'over') {
    showAfter(state, nav);
    return;
  }
  if (b.headerRound !== b.round) {
    b.headerRound = b.round;
    ui.log(`Round ${b.round}`, 'system');
  }
  const servantUp = hasServant(state) && state.servant.hp.current > 0;
  if (b.step === 'servant' && servantUp) showServantOrders(state, nav);
  else showMasterActions(state, nav, { canGoBack: servantUp });
}

function showServantOrders(state, nav) {
  const name = findById('servants', state.servant.id).name;
  ui.setChoices(servantOptions(state).map((opt) => ({
    label: opt.label,
    hint: opt.hint,
    disabled: opt.disabled,
    style: opt.type === 'np' ? 'primary' : undefined,
    onSelect: async () => {
      state.battle.pending = opt;
      state.battle.step = 'master';
      await nav.autosave();
      showMasterActions(state, nav, { canGoBack: true, servantLabel: `${name}: ${opt.label}` });
    },
  })), { header: statusCard(state) });
}

function showMasterActions(state, nav, { canGoBack }) {
  const choices = masterOptions(state).map((opt) => ({
    label: opt.label,
    hint: opt.hint,
    disabled: opt.disabled,
    onSelect: () => (opt.type === 'seal' ? showSeals(state, nav, opt) : resolve(state, nav, opt, null)),
  }));
  if (canGoBack) {
    choices.push({
      label: 'Back',
      hint: `Change your Servant's order (now: ${state.battle.pending?.label ?? '—'})`,
      onSelect: async () => {
        state.battle.step = 'servant';
        state.battle.pending = null;
        await nav.autosave();
        showServantOrders(state, nav);
      },
    });
  }
  ui.setChoices(choices, { header: statusCard(state) });
}

function showSeals(state, nav, sealOption) {
  ui.setChoices([
    ...SEAL_OPTIONS.filter((s) => !(state.battle.final && s.kind === 'escape')).map((s) => ({ label: s.label, hint: s.hint, onSelect: () => resolve(state, nav, sealOption, s.kind) })),
    { label: 'Back', onSelect: () => showMasterActions(state, nav, { canGoBack: hasServant(state) && state.servant.hp.current > 0 }) },
  ], { header: statusCard(state) });
}

async function resolve(state, nav, masterOpt, seal) {
  const b = state.battle;
  const lines = resolveRound(state, { servant: b.pending, master: masterOpt, seal });
  for (const line of lines) ui.log(line.text, line.kind);
  b.pending = null;
  if (b.step !== 'over') b.step = hasServant(state) && state.servant.hp.current > 0 ? 'servant' : 'master';
  await nav.autosave();
  render(state, nav);
}

// ---- Status card ----

function condition(hp) {
  const f = hp.current / hp.max;
  if (f <= 0) return 'down';
  if (f > 0.9) return 'unhurt';
  if (f > 0.6) return 'wounded';
  if (f > 0.3) return 'badly hurt';
  return 'near death';
}

function statusCard(state) {
  const rival = battleRival(state);
  const m = state.master;
  const lines = [];
  const you = [];
  if (hasServant(state)) {
    const s = findById('servants', state.servant.id);
    you.push(`${s.name} HP ${state.servant.hp.current}/${state.servant.hp.max}`);
  } else {
    you.push('No Servant');
  }
  you.push(`You HP ${m.hp.current}/${m.hp.max}`, `Mana ${m.mana.current}/${m.mana.max}`);
  if (hasServant(state)) you.push(`Seals ${m.commandSeals}`);
  lines.push(you.join(' · '));

  const enemy = [];
  const sHp = rival.servant.hp;
  const sName = rival.intel.servant >= 3 ? findById('servants', rival.servant.id).name
    : rival.intel.servant >= 1 ? `Enemy ${findById('servants', rival.servant.id).class}` : 'Enemy Servant';
  enemy.push(rival.intel.servant >= 2 ? `${sName} HP ${sHp.current}/${sHp.max}` : `${sName}: ${condition(sHp)}`);
  const mName = rival.intel.master >= 2 ? rival.master.name : 'Their Master';
  const mHp = rival.master.hp;
  enemy.push(rival.intel.master >= 3 ? `${mName} HP ${mHp.current}/${mHp.max}` : `${mName}: ${condition(mHp)}`);
  lines.push(enemy.join(' · '));
  return lines.join('\n');
}

// ---- After the battle ----

function showAfter(state, nav) {
  const result = state.battle.result;
  if (result.outcome === 'masterKilled') {
    state.ending = { type: 'masterDied' };
    nav.goTo('ending');
    return;
  }
  if (result.outcome === 'servantLost' && !state.battle.lossHandled) {
    const t = getData('combat').afterLoss;
    ui.log(t.prompt, 'system');
    const rival = battleRival(state);
    ui.setChoices([
      {
        label: t.church,
        hint: `${t.churchHint} (about ${Math.round(churchSave(state, rival) * 100)}% chance)`,
        onSelect: async () => {
          const safe = chance(churchSave(state, rival));
          state.ending = { type: safe ? 'church' : 'churchKilled' };
          await nav.goTo('ending');
        },
      },
      {
        label: t.alone,
        hint: t.aloneHint,
        onSelect: async () => {
          state.battle.lossHandled = true;
          if (state.battle.final) {
            // The last night: keep fighting, alone, right now.
            const rival = battleRival(state);
            for (const line of startBattle(state, rival, 'final')) ui.log(line.text, line.kind);
            render(state, nav);
            await nav.autosave();
            return;
          }
          await finish(state, nav);
        },
      },
    ]);
    return;
  }
  ui.setChoices([{ label: 'Continue', style: 'primary', onSelect: () => finish(state, nav) }]);
}

// Record the battle in today's history and go back to the war.
async function finish(state, nav) {
  const b = state.battle;
  if (b.final && b.result.outcome === 'won') {
    state.battle = null;
    state.ending = { type: 'victory' };
    await nav.goTo('ending');
    return;
  }
  const today = state.war.history[state.war.history.length - 1];
  today.battle = { rivalId: b.rivalId, outcome: b.result.outcome };
  state.battle = null;
  state.war.stage = 'endNight';
  await nav.goTo('war', { resumed: true });
}
