import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PEAK_AGE,
  wearDown,
  retirementChance,
  MAX_AGE,
  agingSummer,
  fillRosters,
  LEGEND_RETURN_SEASONS,
} from "../src/aging.js";
import { createLeague, RETIRED } from "../src/league.js";
import { inGameStats } from "../src/individual.js";
import { typicalLevel } from "../src/growth.js";
import { speciesById } from "../src/dex.js";
import { makeRng } from "../src/random.js";
import { RULES } from "../src/ratings.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url), "utf8"));
const league = (seed = 41) => createLeague({ dex, seed, userTid: 0 });

test("nobody wears down before his position's peak age", () => {
  const L = league();
  for (const pos of ["C", "W", "D", "G"]) {
    const p = L.players.find((x) => x.pos === pos);
    p.age = PEAK_AGE[pos];
    p.wear = 0;
    assert.equal(wearDown(p), false, pos);
    assert.equal(p.wear, 0);
    p.age++;
    assert.equal(wearDown(p), true, pos);
    assert.ok(p.wear > 0);
  }
});

test("Speed fades twice as fast as the other stats, and more each season", () => {
  const L = league();
  const p = L.players.find((x) => x.pos === "W");
  const species = speciesById[p.species];
  const fresh = inGameStats(species, { ...p, wear: 0 });
  const steps = [];
  for (let age = PEAK_AGE.W + 1; age <= PEAK_AGE.W + 4; age++) {
    const before = p.wear ?? 0;
    p.age = age;
    wearDown(p);
    steps.push(p.wear - before);
  }
  assert.ok(
    steps.every((s, i) => i === 0 || s > steps[i - 1]),
    "each season past the peak costs more",
  );
  const aged = inGameStats(species, p);
  const drop = (k) => 1 - aged[k] / fresh[k];
  assert.ok(Math.abs(drop("spe") - 2 * p.wear) < 0.02, `speed ${drop("spe")}`);
  assert.ok(Math.abs(drop("atk") - p.wear) < 0.02, `attack ${drop("atk")}`);
  const ovr = p.ovrs.W;
  p.wear = 0;
  p.age = 20;
  wearDown(p);
  assert.ok(ovr < p.ovrs.W || p.wear === 0);
});

test("retirement starts at 30, rises with age, comes later for stars and sooner without a team", () => {
  const L = league();
  const p = { ...L.players.find((x) => x.tid >= 0), ovrs: { C: 50, W: 50, D: 50, G: 50 }, tid: 3 };
  const at = (age, extra = {}) => retirementChance({ ...p, age, ...extra });
  assert.equal(at(29), 0);
  assert.ok(at(30) > 0);
  for (let age = 31; age < MAX_AGE; age++) assert.ok(at(age) >= at(age - 1), `${age}`);
  assert.equal(at(MAX_AGE), 1);
  assert.ok(at(34, { ovrs: { C: 80, W: 70, D: 60, G: 40 } }) < at(34));
  assert.ok(at(34, { tid: -1 }) > at(34));
});

test("a summer retires veterans and refills every roster from free agents and reserve lists", () => {
  const L = league(43);
  for (const p of L.players) p.age++;
  const before = L.players.length;
  const rng = makeRng(9);
  const { retired } = agingSummer(L, rng);
  assert.ok(retired.length > 10, `${retired.length} retired`);
  for (const p of retired) {
    assert.equal(p.tid, RETIRED);
    assert.equal(p.jersey, undefined, "a retired player keeps only his story");
    assert.ok(p.age >= 30);
    assert.ok(p.career && p.retired && p.name);
  }
  // Nobody appears out of thin air: new players come from the draft.
  assert.equal(L.players.length, before);
  for (const t of L.teams) {
    const roster = L.players.filter((p) => p.tid === t.tid);
    if (t.tid === L.userTid) assert.ok(roster.length >= RULES.minRoster);
    else assert.equal(roster.length, RULES.rosterMax, t.abbr);
    assert.ok(roster.filter((p) => p.legendary).length <= RULES.maxLegendariesPerTeam);
  }
  assert.match(L.news.map((n) => n.text).join("\n"), /\d+ players retired, led by/);
});

test("CPU teams sign for the position they're short at; your team is only topped up to the minimum", () => {
  const L = league(44);
  const cpu = L.players.filter((p) => p.tid === 5);
  for (const p of cpu.filter((x) => x.pos === "G").slice(0, 2)) p.tid = RETIRED;
  const mine = L.players.filter((p) => p.tid === 0);
  for (const p of mine.slice(0, 6)) p.tid = RETIRED;
  const signed = fillRosters(L);
  const newCpu = signed.filter((p) => p.tid === 5);
  assert.deepEqual(
    newCpu.map((p) => p.pos),
    ["G", "G"],
  );
  assert.equal(L.players.filter((p) => p.tid === 0).length, RULES.minRoster);
});

test("a retired Legendary's species returns as a new free agent a few seasons later", () => {
  const L = league(45);
  const legend = L.players.find((p) => p.legendary && p.tid >= 0);
  legend.age = MAX_AGE;
  const rng = makeRng(3);
  agingSummer(L, rng);
  assert.equal(legend.tid, RETIRED);
  const returning = () => L.players.filter((p) => p.species === legend.species && p.tid !== RETIRED);
  for (let s = 1; s < LEGEND_RETURN_SEASONS; s++) {
    L.season++;
    agingSummer(L, rng);
    assert.equal(returning().length, 0, `after ${s} summers`);
  }
  L.season++;
  agingSummer(L, rng);
  const back = returning();
  assert.equal(back.length, 1);
  assert.ok(back[0].age <= 24 && back[0].pid !== legend.pid);
  assert.match(L.news.map((n) => n.text).join("\n"), new RegExp(`A new ${legend.name} has appeared`));
});

test("a new league starts its players on the typical growth curve for their age", () => {
  const L = league(46);
  const avg = (ps) => ps.reduce((a, p) => a + p.level, 0) / ps.length;
  const young = L.players.filter((p) => p.age <= 21);
  const old = L.players.filter((p) => p.age >= 31);
  assert.ok(avg(old) - avg(young) > 15, `${avg(young)} vs ${avg(old)}`);
  assert.ok(typicalLevel(18) < typicalLevel(22) && typicalLevel(22) < typicalLevel(30));
});
