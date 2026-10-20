import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  statValue,
  inGameStats,
  toBaseScale,
  playerSkills,
  judgeIv,
  startingLevel,
  evolutionLevels,
  hatch,
  NATURES,
  REFERENCE_LEVEL,
  STAT_KEYS,
} from "../src/individual.js";
import { speciesSkills } from "../src/ratings.js";
import { createLeague, dexById } from "../src/league.js";
import { makeRng } from "../src/random.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url)));
const byId = dexById(dex);

test("the stat formula matches the games: Bulbapedia's level 78 Adamant Garchomp", () => {
  // Base 108/130/95/80/85/102, IVs 24/12/30/16/23/5, EVs 74/190/91/48/84/23.
  const g = byId.garchomp.bs;
  const ivs = { hp: 24, atk: 12, def: 30, spa: 16, spd: 23, spe: 5 };
  const evs = { hp: 74, atk: 190, def: 91, spa: 48, spd: 84, spe: 23 };
  const got = Object.fromEntries(STAT_KEYS.map((k) => [k, statValue(k, g[k], ivs[k], 78, "Adamant", evs[k])]));
  assert.deepEqual(got, { hp: 289, atk: 278, def: 193, spa: 135, spd: 171, spe: 171 });
});

test("a nature raises one stat by 10%, lowers one by 10% and leaves the rest", () => {
  const species = byId.garchomp;
  const ivs = Object.fromEntries(STAT_KEYS.map((k) => [k, 20]));
  const neutral = inGameStats(species, { level: 50, ivs, nature: "Hardy" });
  for (const [nature, change] of Object.entries(NATURES)) {
    const stats = inGameStats(species, { level: 50, ivs, nature });
    for (const k of STAT_KEYS) {
      const want = !change
        ? neutral[k]
        : k === change[0]
          ? Math.floor(neutral[k] * 1.1)
          : k === change[1]
            ? Math.floor(neutral[k] * 0.9)
            : neutral[k];
      assert.equal(stats[k], want, `${nature} ${k}`);
    }
  }
});

test("at level 50 with average IVs and a neutral nature, a player rates like his species", () => {
  for (const id of ["garchomp", "pikachu", "blissey", "shuckle", "mewtwo"]) {
    const s = byId[id];
    const value = (k, iv) => statValue(k, s.bs[k], iv, REFERENCE_LEVEL, "Hardy");
    // Averaging IVs 15 and 16 lands on 15.5 exactly.
    for (const k of STAT_KEYS) {
      const mid = (toBaseScale(k, value(k, 15), REFERENCE_LEVEL) + toBaseScale(k, value(k, 16), REFERENCE_LEVEL)) / 2;
      assert.ok(Math.abs(mid - s.bs[k]) <= 1, `${id} ${k}: ${mid} vs ${s.bs[k]}`);
    }
    const ivs = Object.fromEntries(STAT_KEYS.map((k) => [k, 16]));
    const skills = playerSkills(s, { level: REFERENCE_LEVEL, ivs, nature: "Hardy" });
    const base = speciesSkills(s);
    for (const k of Object.keys(base)) assert.ok(Math.abs(skills[k] - base[k]) <= 1, `${id} ${k}`);
  }
});

test("higher levels and better IVs make a better player", () => {
  const s = byId.tyranitar;
  const ivs = (x) => Object.fromEntries(STAT_KEYS.map((k) => [k, x]));
  const sum = (sk) => Object.values(sk).reduce((a, b) => a + b, 0);
  const lv40 = sum(playerSkills(s, { level: 40, ivs: ivs(15), nature: "Hardy" }));
  const lv60 = sum(playerSkills(s, { level: 60, ivs: ivs(15), nature: "Hardy" }));
  const best = sum(playerSkills(s, { level: 60, ivs: ivs(31), nature: "Hardy" }));
  assert.ok(lv60 > lv40);
  assert.ok(best > lv60);
});

test("the IV judge uses the games' words", () => {
  assert.equal(judgeIv(31).label, "Best");
  assert.equal(judgeIv(30).label, "Fantastic");
  assert.equal(judgeIv(27).label, "Very good");
  assert.equal(judgeIv(16).label, "Pretty good");
  assert.equal(judgeIv(15).label, "Decent");
  assert.equal(judgeIv(0).label, "No good");
});

test("starting levels respect evolution: never below the level evolved at, never at the next one", () => {
  const rng = makeRng(3);
  assert.deepEqual(evolutionLevels(byId.charmeleon, byId), { from: 16, to: 36 });
  assert.deepEqual(evolutionLevels(byId.pikachu, byId), { from: null, to: null });
  for (let i = 0; i < 200; i++) {
    const age = rng.int(19, 35);
    assert.ok(startingLevel(byId.charmeleon, age, byId, rng) < 36);
    assert.ok(startingLevel(byId.charmeleon, age, byId, rng) >= 16);
    assert.ok(startingLevel(byId.hydreigon, age, byId, rng) >= 64);
    assert.ok(startingLevel(byId.pupitar, age, byId, rng) < 55);
  }
});

test("two individuals of one species differ", () => {
  const rng = makeRng(11);
  const a = hatch(byId.gible, { level: 20, rng });
  const b = hatch(byId.gible, { level: 20, rng });
  assert.notDeepEqual(a.ivs, b.ivs);
  assert.notDeepEqual(playerSkills(byId.gible, a), playerSkills(byId.gible, b));
});

test("every player in a new league is a complete individual", () => {
  const state = createLeague({ dex, seed: 21 });
  for (const p of state.players) {
    assert.ok(Number.isInteger(p.level) && p.level >= 2 && p.level <= 100);
    for (const k of STAT_KEYS) assert.ok(p.ivs[k] >= 0 && p.ivs[k] <= 31);
    assert.ok(p.nature in NATURES);
    assert.equal(typeof p.nickname, "string");
  }
});
