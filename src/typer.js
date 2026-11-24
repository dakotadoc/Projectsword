// Typewriter: new text in the log is revealed a few characters at a time,
// as if being written. Used by ui.js for every new log entry and for
// streamed AI replies (which arrive in uneven chunks and are smoothed out).
//
// The player can skip (show everything now) at any time. With "reduce
// motion" turned on in the device's settings, text appears instantly.

const BASE_CPS = 82; // characters per second for normal narration (25% slower than the first 110)
// Bigger, less "spoken" blocks type faster.
const KIND_SPEED = { card: 4, effect: 2, system: 1.6, heading: 1.6, player: 3 };

let queue = []; // jobs, typed one after another in order
let running = false;
let lastTime = 0;
let idleCallbacks = [];
let followNode = () => {};

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// follow(node) is called while a node is being typed, to keep it in view.
export function setFollow(fn) {
  followNode = fn;
}

// Start typing `text` into `node`. With { open: true } the text can keep
// growing (job.setTarget) until job.close(finalText) — for streamed replies;
// until the first text arrives, the node keeps its placeholder.
export function type(node, text, kind, { open = false } = {}) {
  // `node` receives the text; `box` is the whole log entry (they differ when
  // the entry has an emblem beside its text).
  const box = node.closest?.('.entry') || node;
  const job = { node, box, target: text, shown: 0, kind, open };
  job.setTarget = (t) => {
    job.target = t;
    wake();
  };
  job.close = (t) => {
    job.target = t;
    job.open = false;
    wake();
  };
  // Lines wait, hidden, until the ones before them are done.
  box.classList.add('typing', 'queued');
  queue.push(job);
  if (reducedMotion()) skip();
  else wake();
  return job;
}

export function isBusy() {
  return queue.length > 0;
}

// Run cb once nothing is left to type (right away if already idle).
export function whenIdle(cb) {
  if (!queue.length) cb();
  else idleCallbacks.push(cb);
}

// Show all pending text immediately.
export function skip() {
  for (const job of queue) {
    job.shown = job.target.length;
    render(job);
  }
  const last = queue[queue.length - 1];
  queue = queue.filter((job) => job.open);
  queue.forEach(render);
  if (last) followNode(last.box);
  if (!queue.length) fireIdle();
}

// Forget everything pending (the log was cleared or replaced).
export function clear() {
  queue = [];
  fireIdle();
}

function wake() {
  if (running || !queue.length) return;
  if (reducedMotion()) {
    skip();
    return;
  }
  running = true;
  lastTime = performance.now();
  requestAnimationFrame(tick);
}

function tick(now) {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;
  let budget = dt * BASE_CPS; // in "normal characters"
  let current = null;

  while (queue.length && budget > 0) {
    const job = queue[0];
    current = job;
    job.box.classList.remove('queued');
    const behind = job.target.length - job.shown;
    // Catch up when a stream has raced ahead, or a block is very long.
    const speed = (KIND_SPEED[job.kind] || 1) * (behind > 400 ? 2.5 : behind > 150 ? 1.5 : 1);
    if (behind > 0) {
      const step = Math.min(behind, budget * speed);
      job.shown += step;
      budget -= step / speed;
      render(job);
    }
    if (job.shown >= job.target.length) {
      if (job.open) break; // wait for more streamed text
      queue.shift();
      render(job);
    }
  }
  if (current) followNode(current.box);

  if (queue.length) {
    requestAnimationFrame(tick);
  } else {
    running = false;
    fireIdle();
  }
}

function render(job) {
  job.box.classList.remove('queued');
  const done = !job.open && job.shown >= job.target.length;
  if (job.target.length === 0 && job.open) return; // keep the placeholder
  job.node.textContent = done ? job.target : job.target.slice(0, Math.floor(job.shown));
  if (done) job.box.classList.remove('typing', 'entry-pending');
  else if (job.shown > 0) job.box.classList.remove('entry-pending');
}

function fireIdle() {
  const cbs = idleCallbacks;
  idleCallbacks = [];
  cbs.forEach((cb) => cb());
}
