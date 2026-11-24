// Where saves are kept. Today: the browser's localStorage, falling back to
// memory (lost on reload) when the browser blocks it, as sandboxed artifact
// pages may. The API is async so this can later be swapped for the artifact's
// per-person `db` storage without touching the rest of the game.

const memory = new Map();

function canUseLocalStorage() {
  try {
    const key = '__hgws_probe__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

let persistent = canUseLocalStorage();

export const storage = {
  // False when saves only last until the page is closed.
  get persistent() {
    return persistent;
  },

  async get(key) {
    if (persistent) {
      try {
        return localStorage.getItem(key);
      } catch {
        persistent = false;
      }
    }
    return memory.get(key) ?? null;
  },

  // Returns true if the value was stored persistently.
  async set(key, value) {
    memory.set(key, value);
    if (persistent) {
      try {
        localStorage.setItem(key, value);
        return true;
      } catch {
        persistent = false; // e.g. storage full or blocked mid-session
      }
    }
    return false;
  },

  async remove(key) {
    memory.delete(key);
    if (persistent) {
      try {
        localStorage.removeItem(key);
      } catch {
        persistent = false;
      }
    }
  },
};
