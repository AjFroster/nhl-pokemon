// The Pokédex, for game logic that needs a species' data while the league
// plays (evolution, projections). Bundled into the game by esbuild.
import dex from "../data/pokedex.json" with { type: "json" };

export const DEX = dex;
export const speciesById = Object.fromEntries(dex.map((s) => [s.id, s]));
