// The conversation screen: the player types, the Servant answers.
//
// state.chat = {
//   returnTo,     // screen to go back to afterwards
//   occasion,     // e.g. 'after the summoning', 'day 3' (stored with the memory)
//   messages: [{ role: 'master'|'servant', text }],
//   noticeShown,  // last offline/test-mode notice shown (each shown once per talk)
// }

import * as ui from './ui.js';
import { getState } from './state.js';
import { getData } from './data.js';
import { getServantReply, endConversation, greetingLine, currentServant } from './servantTalk.js';
import { signed } from './events.js';

// Start a conversation, then come back to `returnTo`.
export function openChat(goTo, { returnTo, occasion }) {
  const state = getState();
  state.chat = { returnTo, occasion, messages: [], noticeShown: false };
  return goTo('chat');
}

export async function chatScreen({ resumed = false, goTo, autosave }) {
  const state = getState();
  const chat = state.chat;
  const servant = currentServant(state);
  const rules = getData('rules').chat;

  if (!resumed) {
    ui.log(`You sit down to talk with ${servant.name}.`, 'system');
    const greeting = greetingLine(state);
    chat.messages.push({ role: 'servant', text: greeting });
    ui.log(`“${greeting}”`, 'speech', { emblem: servant.class });
  }

  const left = () => rules.maxPlayerMessages - chat.messages.filter((m) => m.role === 'master').length;
  const placeholder = () => (left() > 0
    ? `Say something to ${servant.name} (${left()} left)`
    : `${servant.name} has said enough for now.`);

  const controls = ui.setChatInput({
    placeholder: placeholder(),
    maxLength: rules.maxMessageLength,
    canSend: left() > 0,
    onSend: async (text) => {
      chat.messages.push({ role: 'master', text });
      ui.log(text, 'player');
      const entry = ui.beginEntry('speech', '…', { emblem: servant.class });
      const reply = await getServantReply(state, chat.messages, {
        onText: (t) => entry.update(`“${t}”`),
      });
      entry.commit(`“${reply.text}”`);
      chat.messages.push({ role: 'servant', text: reply.text });
      if (reply.notice && reply.notice !== chat.noticeShown) {
        ui.log(reply.notice, 'system');
        chat.noticeShown = reply.notice; // each different notice once per talk
      }
      controls.setPlaceholder(placeholder());
      controls.setCanSend(left() > 0);
      await autosave();
    },
    onEnd: async () => {
      const entry = ui.beginEntry('effect', `${servant.name} thinks over your conversation…`);
      const result = await endConversation(state, chat.messages, { occasion: chat.occasion });
      if (result) {
        const change = result.bondDelta ? `Bond ${signed(result.bondDelta)} (${result.bond})` : `Bond unchanged (${result.bond})`;
        entry.commit(`${change} · ${servant.name} seems ${result.mood}`);
      } else {
        entry.commit('You say nothing more, and the moment passes.');
      }
      const { returnTo } = chat;
      state.chat = null;
      await goTo(returnTo, { resumed: true });
    },
  });
  if (!resumed) controls.focus();
}
