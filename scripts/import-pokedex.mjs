// Rebuilds data/pokedex.json from Pokémon Showdown's Pokédex (MIT licensed).
// Keeps the 1,025 base species with base stats, size, types and evolution links.
import fs from "node:fs";

const SOURCE = "https://raw.githubusercontent.com/smogon/pokemon-showdown/master/data/pokedex.ts";
const OUT = new URL("../data/pokedex.json", import.meta.url);
const toId = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const res = await fetch(SOURCE);
if (!res.ok) throw new Error(`Could not download the Pokédex (${res.status})`);
const src = (await res.text()).replace(/^export const Pokedex[^=]*=/m, "return");
const dex = new Function(src)();

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
    evoLevel: p.evoLevel,
    tags: p.tags,
  });
}
out.sort((a, b) => a.num - b.num);
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`Wrote ${out.length} Pokémon to data/pokedex.json`);
