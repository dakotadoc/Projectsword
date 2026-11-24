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
export function log(text, kind = 'narration') {
  addLogEntry(text, kind);
  $('log').append(makeEntry({ text, kind }));
  scrollLogToEnd();
}

export function renderLog(entries) {
  $('log').replaceChildren(...entries.map(makeEntry));
  scrollLogToEnd();
}

export function clearLog() {
  $('log').replaceChildren();
}

function makeEntry({ text, kind }) {
  const p = document.createElement('p');
  p.className = `entry entry-${kind || 'narration'}`;
  p.textContent = text;
  return p;
}

function scrollLogToEnd() {
  const el = $('log');
  el.scrollTop = el.scrollHeight;
}

// ---- Choices ----

// choices: [{ label, onSelect, disabled?, hint?, style?: 'primary'|'danger' }]
// Clicking one disables all until onSelect finishes (no double actions).
export function setChoices(choices) {
  const box = $('choices');
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
