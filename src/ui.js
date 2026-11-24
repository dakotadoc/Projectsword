// Everything that touches the page: the narration log, choice buttons,
// in-page dialogs, and the status bar. Game systems call these; they never
// build DOM themselves.
//
// All text is set with textContent, never innerHTML, so content (including
// AI replies later) can't inject markup.

import { addLogEntry } from './state.js';

const $ = (id) => document.getElementById(id);

// ---- Log ----

// kind: 'narration' (default), 'heading', 'system', 'roll'
// The first entry added since the player last got choices. When new choices
// appear, the log scrolls so this entry is at the top: the player reads the
// new text from its start, however long it is.
let firstUnread = null;

export function log(text, kind = 'narration') {
  addLogEntry(text, kind);
  const entry = makeEntry({ text, kind });
  $('log').append(entry);
  firstUnread ??= entry;
}

export function renderLog(entries) {
  $('log').replaceChildren(...entries.map(makeEntry));
  firstUnread = null;
  const el = $('log');
  el.style.scrollBehavior = 'auto';
  el.scrollTop = el.scrollHeight;
  el.style.scrollBehavior = '';
}

export function clearLog() {
  $('log').replaceChildren();
  firstUnread = null;
}

// A log entry whose text arrives bit by bit (a streamed AI reply).
// Shows a placeholder, update(text) replaces the text as it grows, and
// commit(text) saves the final version to the log in state.
export function beginEntry(kind, placeholder = '…') {
  const entry = makeEntry({ text: placeholder, kind });
  entry.classList.add('entry-pending');
  $('log').append(entry);
  keepInView(entry);
  return {
    update(text) {
      entry.textContent = text;
      keepInView(entry);
    },
    commit(text) {
      entry.textContent = text;
      entry.classList.remove('entry-pending');
      addLogEntry(text, kind);
      keepInView(entry);
    },
  };
}

// Scroll so the end of `entry` is visible, but never past its start.
function keepInView(entry) {
  const el = $('log');
  const bottom = el.scrollHeight - el.clientHeight;
  const entryTop = entry.offsetTop - 16;
  el.scrollTop = Math.min(bottom, Math.max(entryTop, el.scrollTop));
  firstUnread = null;
}

function makeEntry({ text, kind }) {
  const p = document.createElement('p');
  p.className = `entry entry-${kind || 'narration'}`;
  p.textContent = text;
  return p;
}

function scrollToUnread() {
  const el = $('log');
  if (firstUnread?.isConnected) {
    const gap = parseFloat(getComputedStyle(firstUnread).marginTop) || 0;
    el.scrollTop = firstUnread.offsetTop - gap - 8; // .log is position: relative
  } else {
    el.scrollTop = el.scrollHeight;
  }
  firstUnread = null;
}

// ---- Choices ----

// choices: [{ label, onSelect, disabled?, hint?, style?: 'primary'|'danger' }]
// Clicking one disables all until onSelect finishes (no double actions).
export function setChoices(choices) {
  const box = $('choices');
  // Wait a frame so the choices' height is known before scrolling the log.
  requestAnimationFrame(scrollToUnread);
  const buttons = choices.map((choice) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `choice ${choice.style ? `choice-${choice.style}` : ''}`.trim();
    btn.textContent = choice.label;
    if (choice.hint) {
      const hint = document.createElement('span');
      hint.className = 'choice-hint';
      hint.textContent = choice.hint;
      btn.append(hint);
    }
    btn.disabled = Boolean(choice.disabled);
    btn.addEventListener('click', async () => {
      buttons.forEach((b) => (b.disabled = true));
      try {
        await choice.onSelect();
      } finally {
        // If the handler didn't replace the choices, re-enable them.
        if (btn.isConnected) {
          buttons.forEach((b, i) => (b.disabled = Boolean(choices[i].disabled)));
        }
      }
    });
    return btn;
  });
  box.replaceChildren(...buttons);
}

// ---- Chat input ----

// Replaces the choice buttons with a message box and Send / End buttons.
// onSend(text) and onEnd() may be async; the controls are disabled while
// they run. Returns { focus(), setEnabled(bool), setPlaceholder(text) }.
export function setChatInput({ placeholder, maxLength = 400, onSend, onEnd, endLabel = 'End conversation', canSend = true }) {
  const box = $('choices');
  requestAnimationFrame(scrollToUnread);

  const form = document.createElement('form');
  form.className = 'chat-form';
  const input = document.createElement('textarea');
  input.className = 'chat-input';
  input.rows = 2;
  input.maxLength = maxLength;
  input.placeholder = placeholder;
  input.setAttribute('aria-label', 'Your message');
  input.disabled = !canSend;

  const send = document.createElement('button');
  send.type = 'submit';
  send.className = 'choice-primary';
  send.textContent = 'Send';
  send.disabled = !canSend;

  const end = document.createElement('button');
  end.type = 'button';
  end.textContent = endLabel;

  const row = document.createElement('div');
  row.className = 'chat-buttons';
  row.append(end, send);
  form.append(input, row);
  box.replaceChildren(form);

  let busy = false;
  let sendable = canSend;
  const setBusy = (b) => {
    busy = b;
    input.disabled = b || !sendable;
    send.disabled = b || !sendable;
    end.disabled = b;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy || !sendable) return;
    input.value = '';
    setBusy(true);
    try {
      await onSend(text);
    } finally {
      if (form.isConnected) setBusy(false);
      if (form.isConnected && !input.disabled) input.focus();
    }
  });
  // Enter sends; Shift+Enter makes a new line.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  end.addEventListener('click', async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onEnd();
    } finally {
      if (form.isConnected) setBusy(false);
    }
  });

  return {
    focus: () => input.focus(),
    setPlaceholder: (text) => { input.placeholder = text; },
    setCanSend: (b) => { sendable = b; setBusy(busy); },
  };
}

// ---- Dialogs (built in-page: alert/confirm/prompt are blocked in artifacts) ----

// Opens a modal. `content` is an optional DOM node placed under the text.
// actions: [{ label, onSelect?, style? }] — onSelect may return false to keep
// the dialog open. onClose runs once however the dialog closes (button,
// Escape). Returns a close() function.
export function showDialog({ title, text, content, actions = [{ label: 'Close' }], onClose }) {
  const root = $('dialog-root');
  const previousFocus = document.activeElement;

  const overlay = document.createElement('div');
  overlay.className = 'dialog-overlay';
  const box = document.createElement('div');
  box.className = 'dialog';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');

  const heading = document.createElement('h2');
  heading.className = 'dialog-title';
  heading.id = `dialog-title-${Date.now()}`;
  heading.textContent = title;
  box.setAttribute('aria-labelledby', heading.id);
  box.append(heading);

  if (text) {
    const p = document.createElement('p');
    p.className = 'dialog-text';
    p.textContent = text;
    box.append(p);
  }
  if (content) box.append(content);

  const row = document.createElement('div');
  row.className = 'dialog-actions';
  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = action.style ? `choice-${action.style}` : '';
    btn.textContent = action.label;
    btn.addEventListener('click', async () => {
      const result = action.onSelect ? await action.onSelect() : undefined;
      if (result !== false) close();
    });
    row.append(btn);
  }
  box.append(row);
  overlay.append(box);

  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (previousFocus && previousFocus.isConnected) previousFocus.focus();
    onClose?.();
  }

  document.addEventListener('keydown', onKey);
  root.append(overlay);
  (box.querySelector('textarea, input') || row.querySelector('button'))?.focus();
  return close;
}

// Yes/no question. Resolves true or false (Escape counts as no).
export function confirmDialog(title, text, yesLabel = 'Yes', noLabel = 'Cancel') {
  return new Promise((resolve) => {
    let answer = false;
    showDialog({
      title,
      text,
      actions: [
        { label: noLabel },
        { label: yesLabel, style: 'danger', onSelect: () => { answer = true; } },
      ],
      onClose: () => resolve(answer),
    });
  });
}

// ---- Tabs (Text / Status) ----

const TABS = { text: 'tab-text', status: 'tab-status' };
let currentTab = 'text';
let savedLogScroll = 0;
let renderStatusTab = () => {};

// renderStatus(panelElement) is called each time the Status tab opens.
export function setupTabs(renderStatus) {
  renderStatusTab = renderStatus;
  for (const [name, id] of Object.entries(TABS)) {
    $(id).addEventListener('click', () => showTab(name));
  }
  // Left/right arrows move between tabs, as screen readers expect.
  document.querySelector('.tabbar').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = currentTab === 'text' ? 'status' : 'text';
    showTab(next);
    $(TABS[next]).focus();
  });
}

export function showTab(name) {
  if (name === currentTab) {
    if (name === 'status') renderStatusTab($('panel-status'));
    return;
  }
  const log = $('log');
  if (currentTab === 'text') savedLogScroll = log.scrollTop;
  currentTab = name;
  for (const [tab, id] of Object.entries(TABS)) {
    const selected = tab === name;
    $(id).setAttribute('aria-selected', String(selected));
    $(id).tabIndex = selected ? 0 : -1;
  }
  $('panel-text').hidden = name !== 'text';
  $('panel-status').hidden = name !== 'status';
  if (name === 'status') {
    renderStatusTab($('panel-status'));
    $('panel-status').scrollTop = 0;
  } else {
    log.style.scrollBehavior = 'auto';
    log.scrollTop = savedLogScroll;
    log.style.scrollBehavior = '';
  }
}

// ---- Status bar ----

export function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = kind ? `status-${kind}` : '';
}

export function setSeedLabel(seed) {
  $('seed').textContent = seed ? `Seed ${seed}` : '';
}

export function setGameButtonsEnabled(enabled) {
  $('btn-export').disabled = !enabled;
  $('btn-title').disabled = !enabled;
}
