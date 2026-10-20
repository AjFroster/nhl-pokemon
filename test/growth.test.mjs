import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  expForLevel,
  levelForExp,
  TIERS,
  rollTier,
  skaterGameXp,
  gainExp,
  eligibleEvolutions,
  evolve,
  tryEvolve,
  chooseEvolution,
  trainingCamp,
  applyOutliers,
  seasonOutliers,
  potential,
  finalForms,
  FRIENDSHIP_SEASONS,
} from "../src/growth.js";
import { evolutionMethod } from "../src/individual.js";
import { createLeague, updateSkills } from "../src/league.js";
import { speciesById } from "../src/dex.js";
import { makeRng } from "../src/random.js";
import { playDay } from "../src/season.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url)));

test("experience curves match the games at level 100 and in between", () => {
  const at100 = {
    fast: 800000,
    medium: 1000000,
    "medium-slow": 1059860,
    slow: 1250000,
    erratic: 600000,
    fluctuating: 1640000,
  };
  for (const [growth, exp] of Object.entries(at100)) {
    assert.equal(expForLevel(100, growth), exp, growth);
    assert.equal(expForLevel(1, growth), 0, growth);
    for (let n = 2; n <= 100; n++) assert.ok(expForLevel(n, growth) > expForLevel(n - 1, growth), `${growth} ${n}`);
  }
  // A few known values from the games' tables.
  assert.equal(expForLevel(50, "medium-slow"), 117360);
  assert.equal(expForLevel(50, "erratic"), 125000);
  assert.equal(expForLevel(36, "fluctuating"), 46656);
});

test("levels follow experience, and a level needs all of its XP", () => {
  assert.equal(levelForExp(124999, "medium"), 49);
  assert.equal(levelForExp(125000, "medium"), 50);
  assert.equal(levelForExp(10 ** 9, "medium"), 100);
});

test("potential tiers come out at the All-22 odds", () => {
  const rng = makeRng(5);
  const counts = TIERS.map(() => 0);
  const n = 20000;
  for (let i = 0; i < n; i++) counts[rollTier(rng)]++;
  TIERS.forEach((t, i) => assert.ok(Math.abs(counts[i] / n - t.odds) < 0.015, `${t.name} ${counts[i] / n}`));
});

test("game XP rewards ice time, points and wins", () => {
  const base = { toi: 900, g: 0, a: 0 };
  assert.ok(skaterGameXp({ ...base, toi: 1200 }, false) > skaterGameXp(base, false));
  assert.ok(skaterGameXp({ ...base, g: 1 }, false) > skaterGameXp(base, false));
  assert.ok(skaterGameXp(base, true) > skaterGameXp(base, false));
});

// A league with one player of a chosen species, ready to grow.
const withPlayer = (id, { level, tid = 3 } = {}) => {
  const state = createLeague({ dex, seed: 77, userTid: 0 });
  const p = state.players.find((x) => x.tid === tid);
  const s = speciesById[id];
  Object.assign(p, { species: id, name: s.name, num: s.num, types: s.types, level, evolutions: [] });
  p.exp = expForLevel(level, s.growth);
  updateSkills(p, s);
  return { state, p };
};

test("a level evolution happens on the level-up that reaches it, with a news item", () => {
  const { state, p } = withPlayer("charmeleon", { level: 35, tid: 0 });
  const need = expForLevel(36, "medium-slow") - p.exp;
  const before = p.ovrs[p.pos];
  assert.equal(gainExp(state, p, need), "evolved");
  assert.equal(p.species, "charizard");
  assert.equal(p.name, "Charizard");
  assert.deepEqual(p.evolutions, [{ season: state.season, from: "charmeleon", to: "charizard" }]);
  assert.ok(p.ovrs[p.pos] > before);
  assert.match(state.news[0].text, /Charmeleon “.+” of the .+ evolved into Charizard!/);
});

test("the potential tier multiplies XP", () => {
  const { state, p } = withPlayer("charmeleon", { level: 20 });
  p.tier = 3;
  const before = p.exp;
  gainExp(state, p, 1000);
  assert.equal(p.exp - before, 2000);
});

test("stone evolutions need a breakout season", () => {
  const { state, p } = withPlayer("growlithe", { level: 40 });
  assert.equal(evolutionMethod(speciesById.arcanine).kind, "stone");
  assert.deepEqual(eligibleEvolutions(p), []);
  assert.deepEqual(eligibleEvolutions(p, { breakout: true }), ["arcanine"]);
  trainingCamp(state, [p]);
  assert.equal(p.species, "arcanine");
});

test("friendship evolutions need three seasons with one team, counted at camp", () => {
  const { state, p } = withPlayer("golbat", { level: 30 });
  p.loyalty = { tid: -1, seasons: 0 };
  for (let s = 1; s < FRIENDSHIP_SEASONS; s++) {
    trainingCamp(state);
    assert.equal(p.species, "golbat", `after ${s} seasons`);
  }
  trainingCamp(state);
  assert.equal(p.species, "crobat");
});

test("trade evolutions wait for trades", () => {
  const { p } = withPlayer("kadabra", { level: 60 });
  assert.deepEqual(eligibleEvolutions(p, { breakout: true, camp: true }), []);
});

test("you pick a branching evolution for your own player; CPU teams pick for theirs", () => {
  const mine = withPlayer("eevee", { level: 30, tid: 0 });
  mine.p.loyalty = { tid: 0, seasons: 5 };
  assert.equal(tryEvolve(mine.state, mine.p, { breakout: true, camp: true }), false);
  assert.ok(mine.p.evolveChoices.length > 1);
  assert.equal(mine.p.species, "eevee");
  const pick = mine.p.evolveChoices.at(-1);
  chooseEvolution(mine.state, mine.p.pid, pick);
  assert.equal(mine.p.species, pick);
  assert.equal(mine.p.evolveChoices, null);
  assert.throws(() => chooseEvolution(mine.state, mine.p.pid, "eevee"));

  const cpu = withPlayer("eevee", { level: 30, tid: 5 });
  cpu.p.loyalty = { tid: 5, seasons: 5 };
  assert.equal(tryEvolve(cpu.state, cpu.p, { breakout: true, camp: true }), true);
  assert.notEqual(cpu.p.species, "eevee");
});

test("a breakout raises the tier; a bust drops it at most one step below the start", () => {
  const { state, p } = withPlayer("pikachu", { level: 30 });
  p.age = 22;
  p.tier = p.tierStart = 1;
  applyOutliers(state, { breakouts: [p], busts: [] });
  assert.equal(p.tier, 2);
  for (let i = 0; i < 4; i++) applyOutliers(state, { breakouts: [], busts: [p] });
  assert.equal(p.tier, 0);
  p.age = 30;
  applyOutliers(state, { breakouts: [p], busts: [] });
  assert.equal(p.tier, 0, "veterans don't move up a tier");
});

test("a season has breakouts and busts among players who played enough", () => {
  const state = createLeague({ dex, seed: 4 });
  while (state.phase !== "done") playDay(state);
  const { breakouts, busts } = seasonOutliers(state);
  assert.ok(breakouts.length > 10 && busts.length > 10);
  for (const p of [...breakouts, ...busts]) assert.ok(p.stats.gp >= 25);
});

test("POT looks ahead to the final form and is never below OVR", () => {
  assert.deepEqual(finalForms("charmander"), ["charizard"]);
  assert.ok(finalForms("eevee").length >= 8);
  const { p } = withPlayer("larvitar", { level: 20 });
  assert.ok(potential(p) > Math.max(...Object.values(p.ovrs)) + 30);
  const state = createLeague({ dex, seed: 8 });
  for (const q of state.players) assert.ok(potential(q) >= Math.max(...Object.values(q.ovrs)));
});

test("growing a league is deterministic", () => {
  const run = () => {
    const state = createLeague({ dex, seed: 31 });
    for (let i = 0; i < 40; i++) playDay(state);
    return state.players.map((p) => [p.level, p.exp, p.species]);
  };
  assert.deepEqual(run(), run());
});

test("a player keeps his level when his line changes growth rate", () => {
  const { state, p } = withPlayer("applin", { level: 40 });
  p.loyalty = { tid: p.tid, seasons: 0 };
  p.exp = expForLevel(41, "erratic") - 1;
  evolve(state, p, "dipplin");
  assert.equal(p.level, 40);
  assert.ok(p.exp >= expForLevel(40, "slow") && p.exp < expForLevel(41, "slow"));
});
