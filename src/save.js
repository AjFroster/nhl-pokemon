// Save versions. Every change to the shape of a saved league bumps SAVE_VERSION
// and adds a step to MIGRATIONS that upgrades the previous version, so old
// saves keep working. The play test loads a saved league from every version.

export const SAVE_VERSION = 2;

// MIGRATIONS[n] upgrades a version-n save to version n + 1.
const MIGRATIONS = {
  // Version 2 keeps past seasons: the league's history and each player's career.
  1: (state) => {
    state.history = [];
    for (const p of state.players) p.career = [];
    return state;
  },
};

// Returns the league upgraded to the current version, or null if it can't be read.
export const migrateSave = (state) => {
  if (!state || typeof state.version !== "number" || state.version > SAVE_VERSION) return null;
  while (state.version < SAVE_VERSION) {
    const step = MIGRATIONS[state.version];
    if (!step) return null;
    state = step(state);
    state.version++;
  }
  return state;
};
