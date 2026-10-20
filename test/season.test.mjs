import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createLeague, DRAFT_QUOTA } from "../src/league.js";
import { simGame } from "../src/sim.js";
import { makeRng } from "../src/random.js";
import { playDay, standings, points, signPlayer, releasePlayer, canPlay } from "../src/season.js";
import { RULES } from "../src/ratings.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url), "utf8"));
const newLeague = (seed = 1) => createLeague({ dex, seed, userTid: 0 });

test("the fantasy draft fills every roster within the rules", () => {
  const L = newLeague();
  for (const t of L.teams) {
    const roster = L.players.filter((p) => p.tid === t.tid);
    assert.equal(roster.length, RULES.rosterMax);
    for (const [pos, n] of Object.entries(DRAFT_QUOTA)) assert.equal(roster.filter((p) => p.pos === pos).length, n, `${t.abbr} ${pos}`);
    assert.ok(roster.filter((p) => p.legendary).length <= RULES.maxLegendariesPerTeam);
    const dressed = [...t.lines.F.flat(), ...t.lines.D.flat(), ...t.lines.G];
    assert.equal(new Set(dressed).size, 20);
    assert.ok(dressed.every((pid) => L.players[pid].tid === t.tid));
  }
  const free = L.players.filter((p) => p.tid === -1).length;
  assert.equal(free, dex.length - 32 * RULES.rosterMax);
});

test("the schedule gives every team 82 games, 41 at home, never two in a day", () => {
  const L = newLeague();
  const gp = Array(32).fill(0);
  const home = Array(32).fill(0);
  for (const day of L.schedule) {
    const seen = new Set();
    for (const g of day) {
      assert.ok(!seen.has(g.home) && !seen.has(g.away));
      seen.add(g.home).add(g.away);
      gp[g.home]++;
      gp[g.away]++;
      home[g.home]++;
    }
  }
  assert.ok(gp.every((n) => n === RULES.gamesPerSeason));
  assert.ok(home.every((n) => n === RULES.gamesPerSeason / 2));
});

test("simulated games look like hockey", () => {
  const L = newLeague();
  const rng = makeRng(3);
  let goals = 0;
  let shots = 0;
  let ga = 0;
  let sa = 0;
  let ot = 0;
  const n = 600;
  for (let i = 0; i < n; i++) {
    const g = L.schedule.flat()[i];
    const r = simGame({ home: L.teams[g.home], away: L.teams[g.away], byPid: L.players, rng });
    assert.notEqual(r.score[0], r.score[1]);
    goals += r.score[0] + r.score[1];
    shots += r.shots[0] + r.shots[1];
    for (const gl of r.goalies) {
      ga += gl.ga;
      sa += gl.sa;
    }
    if (r.ot) ot++;
  }
  const gpg = goals / n / 2;
  const spg = shots / n / 2;
  const sv = 1 - ga / sa;
  assert.ok(gpg > 2.6 && gpg < 3.6, `goals per team ${gpg}`);
  assert.ok(spg > 26 && spg < 36, `shots per team ${spg}`);
  assert.ok(sv > 0.89 && sv < 0.92, `save % ${sv}`);
  assert.ok(ot / n > 0.1 && ot / n < 0.3, `overtime rate ${ot / n}`);
});

test("better teams win more often", () => {
  const L = newLeague(5);
  const [strong, weak] = [...L.teams].sort((a, b) => b.ovr - a.ovr).filter((_, i, a) => i === 0 || i === a.length - 1);
  const rng = makeRng(9);
  let wins = 0;
  for (let i = 0; i < 300; i++) {
    const r = simGame({ home: strong, away: weak, byPid: L.players, rng });
    if (r.score[0] > r.score[1]) wins++;
  }
  assert.ok(wins / 300 > 0.55, `strong team won ${wins} of 300`);
});

test("a full season and playoffs crown one champion, and replaying the seed gives the same result", () => {
  const run = () => {
    const L = newLeague(11);
    let days = 0;
    while (L.phase !== "done" && days < 400) {
      playDay(L);
      days++;
    }
    return L;
  };
  const L = run();
  assert.equal(L.phase, "done");
  assert.ok(L.champion >= 0 && L.champion < 32);
  for (const t of L.teams) assert.equal(t.record.w + t.record.l + t.record.otl, 82);
  const totalWins = L.teams.reduce((s, t) => s + t.record.w, 0);
  assert.equal(totalWins, (32 * 82) / 2);
  const final = L.playoffs.rounds[3][0];
  assert.equal(Math.max(...final.wins), 4);
  const st = standings(L);
  assert.equal(Object.keys(st).length, 2);
  assert.equal(run().champion, L.champion);
  assert.ok(points(L.teams[L.champion].record) > 0);
});

test("signing and releasing keep the roster and lines valid", () => {
  const L = newLeague();
  const fa = L.players.find((p) => p.tid === -1 && !p.legendary);
  assert.equal(signPlayer(L, fa.pid).ok, false, "a full roster can't sign anyone");
  const cut = L.players.find((p) => p.tid === 0 && p.pos === "W");
  releasePlayer(L, cut.pid);
  assert.equal(cut.tid, -1);
  assert.ok(![...L.teams[0].lines.F.flat()].includes(cut.pid));
  assert.equal(canPlay(L).ok, true);
  assert.equal(signPlayer(L, fa.pid).ok, true);
  assert.equal(fa.tid, 0);
});
