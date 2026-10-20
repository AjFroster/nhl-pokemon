// Save versions. Every change to the shape of a saved league bumps SAVE_VERSION
// and adds a step to MIGRATIONS that upgrades the previous version, so old
// saves keep working. The play test loads a saved league from every version.

import { makeRng } from "./random.js";
import { hatch, startingLevel } from "./individual.js";
import { updateSkills, dexById, teamOvr } from "./league.js";

export const SAVE_VERSION = 3;

// MIGRATIONS[n] upgrades a version-n save to version n + 1.
const MIGRATIONS = {
  // Version 2 keeps past seasons: the league's history and each player's career.
  1: (state) => {
    state.history = [];
    for (const p of state.players) p.career = [];
    return state;
  },
  // Version 3 makes every player an individual Pokémon with a level, IVs, a
  // nature and a nickname. His skills are worked out again from those, and
  // the hatching uses its own generator so the league's dice don't move.
  2: (state, dex) => {
    const byId = dexById(dex);
    const rng = makeRng(state.seed ^ 0x1d1e);
    for (const p of state.players) {
      const species = byId[p.species];
      Object.assign(p, hatch(species, { level: startingLevel(species, p.age, byId, rng), rng }));
      updateSkills(p, species);
    }
    for (const t of state.teams) t.ovr = teamOvr(t, state.players);
    return state;
  },
};

// Returns the league upgraded to the current version, or null if it can't be read.
// Some steps need the Pokédex.
export const migrateSave = (state, dex) => {
  if (!state || typeof state.version !== "number" || state.version > SAVE_VERSION) return null;
  while (state.version < SAVE_VERSION) {
    const step = MIGRATIONS[state.version];
    if (!step) return null;
    state = step(state, dex);
    state.version++;
  }
  return state;
};
