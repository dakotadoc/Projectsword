// Everything that touches the page: the narration log, choice buttons,
// in-page dialogs, and the status bar. Game systems call these; they never
// build DOM themselves.
//
// All text is set with textContent, never innerHTML, so content (including
// AI replies later) can't inject markup.

import { addLogEntry } from './state.js';
import * as typer from './typer.js';

const $ = (id) => document.getElementById(id);

// ---- Log ----

// kind: 'narration' (default), 'heading', 'system', 'roll', 'card',
// 'effect', 'speech', 'player'.
//
// New text types itself out (typer.js). The log follows the text being
// typed, but never scrolls past the first line of the current "batch" (the
// text produced since the player last acted), so a long passage is read
// from its start. Tapping the log, or pressing Space, shows everything.

let batchStart = null; // first entry of the current batch
let newBatch = true; // the next logged entry starts a new batch

export function log(text, kind = 'narration') {
  addLogEntry(text, kind);
  const entry = makeEntry({ text: '', kind });
  $('log').append(entry);
  markBatch(entry);
  typer.type(entry, text, kind);
}

export function renderLog(entries) {
  typer.clear();
  $('log').replaceChildren(...entries.map(makeEntry));
  batchStart = null;
  newBatch = true;
  const el = $('log');
  el.scrollTop = el.scrollHeight;
}

export function clearLog() {
  typer.clear();
  $('log').replaceChildren();
  batchStart = null;
  newBatch = true;
}

// A log entry whose text arrives bit by bit (a streamed AI reply).
// Shows a placeholder, update(text) gives the text so far, and
// commit(text) gives the final text and saves it to the log in state.
export function beginEntry(kind, placeholder = '…') {
  const entry = makeEntry({ text: placeholder, kind });
  entry.classList.add('entry-pending');
  $('log').append(entry);
  markBatch(entry);
  const job = typer.type(entry, '', kind, { open: true });
  follow(entry);
  return {
    update(text) {
      job.setTarget(text);
    },
    commit(text) {
      job.close(text);
      addLogEntry(text, kind);
    },
  };
}

// Show all text that is still being typed.
export function skipTyping() {
  typer.skip();
}

function markBatch(entry) {
  if (newBatch) {
    batchStart = entry;
    newBatch = false;
  }
}

// Keep the bottom of `node` in view, without scrolling past the start of
// the current batch, and never scrolling back up.
function follow(node) {
  const el = $('log');
  if (!node?.isConnected || el.offsetParent === null) return; // tab hidden
  const wanted = node.offsetTop + node.offsetHeight + 12 - el.clientHeight;
  let limit = Infinity;
  if (batchStart?.isConnected) {
    const gap = parseFloat(getComputedStyle(batchStart).marginTop) || 0;
    limit = batchStart.offsetTop - gap - 8; // .log is position: relative
  }
  const target = Math.min(wanted, limit);
  if (target > el.scrollTop) el.scrollTop = target;
}

function followLast() {
  follow($('log').lastElementChild);
}

typer.setFollow(follow);

function makeEntry({ text, kind }) {
  const p = document.createElement('p');
  p.className = `entry entry-${kind || 'narration'}`;
  p.textContent = text;
  return p;
}

// Buttons wait (dimmed) until the text above them has finished typing.
// Tapping the dimmed area skips the typing.
function holdUntilTyped(box, controls) {
  if (!typer.isBusy()) {
    requestAnimationFrame(followLast);
    return;
  }
  box.classList.add('waiting');
  const wasDisabled = controls.map((c) => c.disabled);
  controls.forEach((c) => (c.disabled = true));
  typer.whenIdle(() => {
    box.classList.remove('waiting');
    controls.forEach((c, i) => {
      if (c.isConnected) c.disabled = wasDisabled[i];
    });
    requestAnimationFrame(followLast);
  });
}

// ---- Choices ----

// choices: [{ label, onSelect, disabled?, hint?, style?: 'primary'|'danger' }]
// Clicking one disables all until onSelect finishes (no double actions).
export function setChoices(choices) {
  const box = $('choices');
  newBatch = true; // whatever is logged after the player acts is a new batch
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
  holdUntilTyped(box, buttons);
}

// ---- Chat input ----

// Replaces the choice buttons with a message box and Send / End buttons.
// onSend(text) and onEnd() may be async; the controls are disabled while
// they run. Returns { focus(), setEnabled(bool), setPlaceholder(text) }.
export function setChatInput({ placeholder, maxLength = 400, onSend, onEnd, endLabel = 'End conversation', canSend = true }) {
  const box = $('choices');
  newBatch = true;
  requestAnimationFrame(followLast);

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
    newBatch = true; // follow the reply from this message on
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

// ---- Skipping text ----

// Tap the story, or the dimmed choices, to show all text at once. Space does
// the same when not typing in a text box.
$('log').addEventListener('click', () => typer.skip());
// Capture phase: check "waiting" BEFORE a button's own handler runs, or the
// click that picks a choice (which starts new text) would also skip it.
$('choices').addEventListener('click', (e) => {
  if (e.currentTarget.classList.contains('waiting')) typer.skip();
}, { capture: true });
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || !typer.isBusy()) return;
  if (e.target.closest?.('input, textarea, button, [contenteditable]')) return;
  e.preventDefault();
  typer.skip();
});
