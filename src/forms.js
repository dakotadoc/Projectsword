// Small form builders for in-page dialogs (custom runs, the debug menu).
// Everything is built with DOM calls and textContent, never innerHTML.

export function textInput({ placeholder = '', maxLength = 100, value = '' } = {}) {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'form-input';
  input.placeholder = placeholder;
  input.maxLength = maxLength;
  input.value = value;
  return input;
}

export function numberInput({ min, max, placeholder = '', value = '' } = {}) {
  const input = document.createElement('input');
  input.type = 'number';
  input.inputMode = 'numeric';
  input.className = 'form-input';
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  input.placeholder = placeholder;
  input.value = value === null || value === undefined ? '' : String(value);
  return input;
}

// options: [[value, label], …]
export function select(options, value = '') {
  const el = document.createElement('select');
  el.className = 'form-input';
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    el.append(o);
  }
  el.value = value;
  return el;
}

// A list of checkboxes. Returns { node, values() }.
export function checkboxList(options, checked = []) {
  const node = document.createElement('div');
  node.className = 'form-checks';
  const boxes = options.map(([v, label]) => {
    const row = document.createElement('label');
    row.className = 'form-check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = v;
    box.checked = checked.includes(v);
    const span = document.createElement('span');
    span.textContent = label;
    row.append(box, span);
    node.append(row);
    return box;
  });
  return { node, values: () => boxes.filter((b) => b.checked).map((b) => b.value) };
}

export function formField(label, control, { wide = false } = {}) {
  const wrap = document.createElement('label');
  wrap.className = wide ? 'form-field form-wide' : 'form-field';
  const span = document.createElement('span');
  span.className = 'form-label';
  span.textContent = label;
  // A checkbox list is not a single control, so use a div wrapper for it.
  if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) {
    const div = document.createElement('div');
    div.className = wrap.className;
    div.append(span, control);
    return div;
  }
  wrap.append(span, control);
  return wrap;
}

export function formGrid(fields) {
  const grid = document.createElement('div');
  grid.className = 'form-grid';
  grid.append(...fields);
  return grid;
}

export function formHeading(text) {
  const h = document.createElement('h3');
  h.className = 'form-heading';
  h.textContent = text;
  return h;
}
