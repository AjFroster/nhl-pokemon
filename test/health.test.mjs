import test from "node:test";
import assert from "node:assert/strict";
import { playSeason, checkSeason, rolloverProblems, runHealth } from "../scripts/league-health.mjs";

// One healthy season, then break it on purpose to prove the checks notice.
const season = playSeason(4242);

test("a normal season passes every league health check", () => {
  assert.deepEqual(checkSeason(season).failures, []);
});

test("league health catches broken rules", () => {
  const broken = structuredClone(season);
  // Two more Legendaries join team 0, and a team gets a win it never played.
  for (const p of broken.players.filter((x) => x.legendary && x.tid !== 0).slice(0, 2)) p.tid = 0;
  broken.teams[1].record.w++;
  const msgs = checkSeason(broken)
    .failures.map((f) => f.msg)
    .join("\n");
  assert.match(msgs, /Legendaries/);
  assert.match(msgs, /record adds up to 83/);
});

test("league health catches a sim that scores too much", () => {
  const broken = structuredClone(season);
  for (const g of broken.games) g.score = g.score.map((x) => x + 2);
  const checks = checkSeason(broken).failures.map((f) => f.check);
  assert.ok(checks.includes("goalsPerTeamGame"));
});

test("league health catches a broken rollover", () => {
  const before = {
    season: 2026,
    players: [
      { age: 20, tid: 0 },
      { age: 25, tid: 1 },
    ],
  };
  const after = {
    season: 2026,
    history: [],
    players: [
      { age: 21, tid: 0 },
      { age: 25, tid: 2 },
    ],
  };
  const msgs = rolloverProblems(before, after, 100_000, 400_000).join("\n");
  assert.match(msgs, /went from 2026 to 2026/);
  assert.match(msgs, /missing from history/);
  assert.match(msgs, /aged a year/);
  assert.match(msgs, /changed teams/);
  assert.match(msgs, /grew 300 KB/);
});

test("leagues played on worker threads give the same report as one at a time", async () => {
  const parallel = await runHealth({ seed: 9, seasons: 2, leagues: 2, workers: 2 });
  const serial = await runHealth({ seed: 9, seasons: 2, leagues: 2, workers: 1 });
  assert.deepEqual(parallel, serial);
  assert.equal(parallel.results.length, 4);
  assert.deepEqual(
    parallel.results.map((r) => [r.league, r.year]),
    [
      [1, 2026],
      [1, 2027],
      [2, 2026],
      [2, 2027],
    ],
  );
  assert.ok(parallel.ok, JSON.stringify(parallel.results.flatMap((r) => r.failures)));
});
