import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createLeague } from "../src/league.js";
import { playDay } from "../src/season.js";
import { startNextSeason } from "../src/offseason.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url), "utf8"));
const playToCup = (state) => {
  for (let i = 0; i < 400 && state.phase !== "done"; i++) playDay(state);
  return state;
};

test("a new season can't start before the Cup is won", () => {
  const L = createLeague({ dex, seed: 21, userTid: 0 });
  assert.throws(() => startNextSeason(L), /isn't over/);
});

test("rolling over keeps the season in history and starts a fresh one", () => {
  const L = playToCup(createLeague({ dex, seed: 21, userTid: 0 }));
  const before = structuredClone(L);
  startNextSeason(L);

  assert.equal(L.season, before.season + 1);
  assert.equal(L.phase, "regular");
  assert.equal(L.day, 0);
  assert.deepEqual(L.games, []);
  assert.equal(L.playoffs, null);
  assert.equal(L.champion, null);

  const h = L.history.at(-1);
  assert.equal(h.season, before.season);
  assert.equal(h.champion, before.champion);
  assert.deepEqual(h.final.toSorted(), [...before.playoffs.rounds[3][0].wins].sort());
  assert.equal(h.teams.find(([tid]) => tid === before.champion)[6], 5);
  assert.equal(h.teams.filter((row) => row[6] === 0).length, 16, "16 teams missed the playoffs");
  const top = before.players[h.leaders.points[0]];
  assert.equal(h.leaders.points[1], top.stats.g + top.stats.a);

  for (const p of L.players) {
    const old = before.players[p.pid];
    assert.equal(p.age, old.age + 1);
    assert.equal(p.tid, old.tid, "rosters carry over");
    assert.equal(p.stats.gp + p.playoffStats.gp, 0);
    if (old.stats.gp) {
      const line = p.career.at(-1);
      assert.deepEqual([line.season, line.tid, line.pos], [before.season, old.tid, old.pos]);
      for (const k of ["gp", "g", "a", "pm", "w", "sa", "ga"]) assert.equal(line.stats[k] ?? 0, old.stats[k], k);
      assert.equal(line.playoffStats?.gp ?? 0, old.playoffStats.gp);
    } else assert.equal(p.career.length, 0);
  }
  for (const t of L.teams) assert.equal(t.record.w + t.record.l + t.record.otl, 0);

  const gp = Array(32).fill(0);
  const home = Array(32).fill(0);
  for (const g of L.schedule.flat()) {
    gp[g.home]++;
    gp[g.away]++;
    home[g.home]++;
  }
  assert.ok(gp.every((n) => n === 82) && home.every((n) => n === 41));
  assert.notDeepEqual(L.schedule, before.schedule, "each season gets its own schedule");
});

test("a league plays three seasons in a row without growing out of hand", () => {
  const L = createLeague({ dex, seed: 22, userTid: 3 });
  const sizes = [];
  for (let s = 0; s < 3; s++) {
    playToCup(L);
    sizes.push(JSON.stringify(L).length);
    startNextSeason(L);
  }
  assert.equal(L.history.length, 3);
  assert.deepEqual(
    L.history.map((h) => h.season),
    [2026, 2027, 2028],
  );
  assert.equal(L.season, 2029);
  const regular = L.players.find((p) => p.tid === 3 && p.pos === "C");
  assert.equal(regular.career.length, 3);
  // Old box scores are dropped, so only the history and career lines add up:
  // under 150 KB a season, or a few MB over decades.
  const perSeason = (sizes[2] - sizes[0]) / 2;
  assert.ok(perSeason < 150_000, `the save grows ${Math.round(perSeason / 1000)} KB a season`);
});
