// Saves the league in the browser. IndexedDB holds a whole season comfortably;
// localStorage is the fallback when IndexedDB isn't available.

const DB = "pokemon-nhl";
const STORE = "leagues";
const KEY = "current";

const openDb = () =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const tx = async (mode, fn) => {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
  });
};

export const saveLeague = async (state) => {
  try {
    await tx("readwrite", (s) => s.put(state, KEY));
    return true;
  } catch {
    try {
      localStorage.setItem(`${DB}:${KEY}`, JSON.stringify(state));
      return true;
    } catch {
      return false;
    }
  }
};

export const loadLeague = async () => {
  try {
    const state = await tx("readonly", (s) => s.get(KEY));
    if (state) return state;
  } catch {
    // fall through to localStorage
  }
  try {
    const raw = localStorage.getItem(`${DB}:${KEY}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

export const deleteLeague = async () => {
  try {
    await tx("readwrite", (s) => s.delete(KEY));
  } catch {
    // ignore
  }
  try {
    localStorage.removeItem(`${DB}:${KEY}`);
  } catch {
    // ignore
  }
};
