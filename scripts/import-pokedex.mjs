// Rebuilds data/pokedex.json from Pokémon Showdown's Pokédex (MIT licensed).
// Keeps the 1,025 base species with base stats, size, types, evolution links
// and how each one evolves, plus each species' growth rate from PokeAPI's data
// files (BSD licensed).
import fs from "node:fs";

const SOURCE = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/pokedex.ts";
const GROWTH_SOURCE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species.csv";
// PokeAPI's growth_rate_id, named as the games name them.
const GROWTH = { 1: "slow", 2: "medium", 3: "fast", 4: "medium-slow", 5: "erratic", 6: "fluctuating" };
const OUT = new URL("../data/pokedex.json", import.meta.url);
const toId = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Could not download the Pokédex (${res.status})`);
const src = (await res.text()).replace(/^export const Pokedex[^=]*=/m, "return");
const dex = new Function(src)();

const growthRes = await fetch(GROWTH_SOURCE);
if (!growthRes.ok) throw new Error(`Could not download growth rates (${growthRes.status})`);
const [header, ...rows] = (await growthRes.text()).trim().split("\n");
const cols = header.split(",");
const growthByNum = {};
for (const row of rows) {
  const cells = row.split(",");
  growthByNum[Number(cells[cols.indexOf("id")])] = GROWTH[cells[cols.indexOf("growth_rate_id")]];
}

const out = [];
for (const [id, p] of Object.entries(dex)) {
  if (p.num < 1 || p.num > 1025 || p.forme || p.baseSpecies) continue;
  out.push({
    id,
    num: p.num,
    name: p.name,
    types: p.types,
    bs: p.baseStats,
    h: p.heightm,
    w: p.weightkg,
    prevo: p.prevo ? toId(p.prevo) : undefined,
    evos: p.evos?.map(toId),
    // How this species evolves from its prevo: a level, or a method such as
    // trade, useItem or levelFriendship, with the item or condition it needs.
    evoType: p.prevo ? (p.evoType ?? "level") : undefined,
    evoLevel: p.evoLevel,
    evoItem: p.evoItem,
    evoCondition: p.evoCondition,
    evoMove: p.evoMove,
    growth: growthByNum[p.num],
    tags: p.tags,
  });
}
out.sort((a, b) => a.num - b.num);
const missing = out.filter((p) => !p.growth).map((p) => p.name);
if (missing.length) throw new Error(`No growth rate for ${missing.join(", ")}`);
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${out.length} Pokémon to data/pokedex.json`);
