// Writes test/fixtures/saves/v<SAVE_VERSION>.json.gz: a league saved by the
// current code, ten days into its second season. Run it before bumping SAVE_VERSION so
// the tests keep checking that saves from this version still load.
import fs from "node:fs";
import zlib from "node:zlib";
import { createLeague } from "../src/league.js";
import { playDay } from "../src/season.js";
import { SAVE_VERSION } from "../src/save.js";
import { startNextSeason } from "../src/offseason.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url), "utf8"));
const state = createLeague({ dex, seed: 3, userTid: 5 });
while (state.phase !== "done") playDay(state);
startNextSeason(state);
for (let i = 0; i < 10; i++) playDay(state);
const file = new URL(`../test/fixtures/saves/v${SAVE_VERSION}.json.gz`, import.meta.url);
fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(state), { level: 9 }));
console.log(`Wrote test/fixtures/saves/v${SAVE_VERSION}.json.gz (${Math.round(fs.statSync(file).size / 1024)} KB)`);
