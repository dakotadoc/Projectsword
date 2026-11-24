// The ONLY place the game asks Claude anything.
//
// Two modes:
// - 'live': the page is published as a Claude artifact and can use the
//   artifact's `sample` capability (no API key, no server).
// - 'stub': anywhere else (local testing), or when the viewer hasn't allowed
//   it. Calls return the canned answer the caller supplies, so the rest of
//   the game works without AI.
//
// Errors are normalized to an AiError with a `kind`:
//   'unavailable' — AI can't be used in this view; the game stays in stub mode
//   'busy'        — rate limited or a passing failure; try again later
//   'refused'     — Claude declined this input
//   'bad_reply'   — the answer couldn't be used (e.g. not JSON)

let samplePromise = null;
let disabled = false; // set once AI turns out to be unusable in this view

export class AiError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

// Resolves the artifact's `sample` function, or null when there is none.
// window.claude only exists inside a Claude artifact viewer.
function getSample() {
  if (!samplePromise) {
    samplePromise = (async () => {
      try {
        if (typeof window === 'undefined' || !window.claude?.use) return null;
        return (await window.claude.use('sample')) || null;
      } catch {
        return null;
      }
    })();
  }
  return samplePromise;
}

// 'live' or 'stub'. Waits (up to ~10 s, inside a viewer) for the runtime.
export async function aiMode() {
  if (disabled) return 'stub';
  return (await getSample()) ? 'live' : 'stub';
}

// Ask for text.
// input: a prompt string, or [{ role: 'user'|'assistant', content }] that
//   starts and ends with a user turn.
// options: { onText(text) to stream, modelTier, stub: () => string }
// Returns { text, mode }.
export async function askText(input, { onText, modelTier = 'quick', stub } = {}) {
  const sample = disabled ? null : await getSample();
  if (!sample) return { text: stub(), mode: 'stub' };
  try {
    const result = await sample(input, {
      modelTier,
      cache: false,
      onText: onText ? ({ text }) => onText(text) : undefined,
    });
    return { text: result.text, mode: 'live' };
  } catch (e) {
    throw normalize(e);
  }
}

// Ask for a JSON value. Same options as askText; stub returns a value.
export async function askJson(input, { modelTier = 'quick', stub } = {}) {
  const sample = disabled ? null : await getSample();
  if (!sample) return { value: stub(), mode: 'stub' };
  try {
    const value = await sample.json(input, { modelTier, cache: false });
    return { value, mode: 'live' };
  } catch (e) {
    throw normalize(e);
  }
}

const UNAVAILABLE = new Set([
  'not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled',
  'capability_removed', 'session_expired',
]);

function normalize(e) {
  const code = e?.code || 'upstream_error';
  if (UNAVAILABLE.has(code)) {
    disabled = true; // never ask again in this view
    return new AiError('unavailable', code);
  }
  if (code === 'refused') return new AiError('refused', code);
  if (code === 'invalid_json' || code === 'empty_completion') return new AiError('bad_reply', code);
  return new AiError('busy', code);
}
