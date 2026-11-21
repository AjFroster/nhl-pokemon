import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createLeague, autoLines, FREE_AGENT } from "../src/league.js";
import { playDay, canPlay, signPlayer, fillLines, releasePlayer } from "../src/season.js";
import { simGame } from "../src/sim.js";
import { makeRng } from "../src/random.js";
import { RULES } from "../src/ratings.js";
import { payroll, capFor, overCap } from "../src/contracts.js";
import { faAsk } from "../src/freeagency.js";
import { playerTradeValue } from "../src/trades.js";
import {
  INJURY,
  DRESSED,
  frailty,
  rollInjury,
  injure,
  placeOnIR,
  backWhen,
  cpuCover,
  summerHeal,
} from "../src/injuries.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url), "utf8"));
const base = createLeague({ dex, seed: 71, userTid: 0 });
const fresh = () => structuredClone(base);
const roster = (L, tid) => L.players.filter((p) => p.tid === tid);
const slots = (t) => [...t.lines.F.flat(), ...t.lines.D.flat(), ...t.lines.G];
const dressed = (L, tid) => new Set(slots(L.teams[tid]));
const forward = (L, tid) => L.players[L.teams[tid].lines.F[0][1]];
// Plays days until the given number have passed, whatever the phase.
const days = (L, n) => {
  for (let i = 0; i < n; i++) playDay(L);
};

test("an injured player can't dress: he leaves the lines and the game plays without him", () => {
  const L = fresh();
  const p = forward(L, 0);
  injure(L, p.pid, { name: "Sprained ankle", days: 10 });
  assert.ok(!dressed(L, 0).has(p.pid));
  assert.equal(slots(L.teams[0]).filter((x) => x != null).length, DRESSED, "someone healthy took his spot");
  assert.ok(!autoLines(roster(L, 0)).F.flat().includes(p.pid));
  // Even if he's put back by hand, he can't play.
  L.teams[0].lines.F[0][1] = p.pid;
  assert.match(canPlay(L).why, /injured player is in your lines/);
  const g = simGame({ home: L.teams[0], away: L.teams[1], byPid: L.players, rng: makeRng(5) });
  assert.equal(g.lines[p.pid], undefined);
  fillLines(L, 0);
  assert.ok(!dressed(L, 0).has(p.pid));
  assert.equal(canPlay(L).ok, true);
});

test("a player misses exactly his days, then gets his spot back", () => {
  const L = fresh();
  const p = forward(L, 0);
  injure(L, p.pid, { name: "Groin strain", days: 3 });
  const sub = L.teams[0].lines.F[0][1];
  assert.notEqual(sub, p.pid);
  assert.match(L.news[0].text, new RegExp(`${p.name} is out about 3 days.*takes his spot`));
  assert.equal(backWhen(L, p), `back around day ${L.day + 4}`);
  // Hurt before the day's games: he misses this day and the next two.
  days(L, 2);
  assert.equal(p.injury.left, 1);
  days(L, 1);
  assert.equal(p.injury, undefined);
  assert.equal(L.teams[0].lines.F[0][1], p.pid, "back in his spot");
  assert.ok(L.news.some((n) => n.text.startsWith(`${p.name} is healthy again. He's back in his spot`)));
});

test("sturdy players get hurt less, and older players get hurt more and heal slower", () => {
  const L = fresh();
  const p = structuredClone(roster(L, 0)[0]);
  const tough = { ...p, age: 25, skills: { ...p.skills, endu: 85, stre: 85 } };
  const frail = { ...p, age: 25, skills: { ...p.skills, endu: 15, stre: 15 } };
  const old = { ...frail, age: 36 };
  assert.ok(frailty(tough) < frailty(frail));
  assert.ok(frailty(old) > frailty(frail));
  const mean = (q) => {
    const rng = makeRng(3);
    let total = 0;
    for (let i = 0; i < 2000; i++) total += rollInjury(rng, q).days;
    return total / 2000;
  };
  assert.ok(mean(old) > mean(frail) * 1.15);
  assert.ok(mean(frail) > 8 && mean(frail) < 25, `about two weeks on average, got ${mean(frail)}`);
});

test("a long injury can go on injured reserve, which frees his roster spot until he heals", () => {
  const L = fresh();
  const mine = roster(L, 0);
  assert.equal(mine.length, RULES.rosterMax);
  const [short, long] = [mine[3], mine[4]];
  injure(L, short.pid, { name: "Bruised knee", days: 3 });
  injure(L, long.pid, { name: "Broken hand", days: 9 });
  assert.match(placeOnIR(L, short.pid).why, /at least 7 more days/);
  const free = L.players.filter((p) => p.tid === FREE_AGENT && !p.injury).sort((a, b) => a.pid - b.pid)[0];
  assert.match(signPlayer(L, free.pid).why, /roster is full/);
  assert.equal(placeOnIR(L, long.pid).ok, true);
  // Make the cap room his salary would need.
  for (const p of mine.slice(10)) p.contract.amount = Math.round(p.contract.amount * 0.8);
  assert.equal(signPlayer(L, free.pid).ok, true, "his spot is free");
  assert.equal(roster(L, 0).length, RULES.rosterMax + 1);
  assert.equal(canPlay(L).ok, true);
  days(L, 10);
  assert.equal(long.injury, undefined, "off injured reserve once healthy");
  assert.match(canPlay(L).why, /at most 23 players/);
  assert.ok(L.news.some((n) => n.text.includes("off injured reserve")));
});

test("a CPU team short of healthy players signs cover, then lets someone go when they're back", () => {
  const L = fresh();
  const tid = 5;
  const hurt = roster(L, tid)
    .filter((p) => p.pos !== "G")
    .slice(0, 5);
  for (const p of hurt) {
    p.contract.amount = Math.round(p.contract.amount * 0.5); // room for the cover
    injure(L, p.pid, { name: "Knee sprain", days: 8 + (p.pid % 3) });
  }
  const fit = roster(L, tid).filter((p) => !p.injury);
  assert.ok(fit.length >= DRESSED, `${fit.length} healthy`);
  assert.ok(roster(L, tid).filter((p) => !p.injury?.ir).length <= RULES.rosterMax);
  assert.ok(
    roster(L, tid).some((p) => p.injury?.ir),
    "someone went on injured reserve",
  );
  assert.ok(slots(L.teams[tid]).every((pid) => pid != null && !L.players[pid].injury));
  assert.ok(payroll(L, tid) <= capFor(L));
  days(L, 12);
  const r = roster(L, tid);
  assert.ok(
    r.every((p) => !p.injury || !hurt.includes(p)),
    "everyone healed",
  );
  assert.equal(r.filter((p) => !p.injury?.ir).length, RULES.rosterMax);
  assert.ok(L.news.some((n) => n.text.includes("to cover for injuries")));
  assert.ok(L.news.some((n) => n.text.includes("to make room")));
  cpuCover(L, tid);
  assert.ok(slots(L.teams[tid]).every((pid) => pid != null && L.players[pid].tid === tid));
});

test("the summer heals all but the longest injuries, and ends injured reserve", () => {
  const L = fresh();
  const [a, b] = roster(L, 3);
  injure(L, a.pid, { name: "Broken leg", days: 80 });
  injure(L, b.pid, { name: "Torn ACL", days: 170 });
  b.injury.ir = true;
  summerHeal(L);
  assert.equal(a.injury, undefined);
  assert.equal(b.injury.left, 170 - INJURY.summerDays);
  assert.equal(b.injury.ir, undefined);
});

test("a player out for the season is worth less in a trade", () => {
  const L = fresh();
  const p = forward(L, 2);
  const before = playerTradeValue(L, p, 4);
  injure(L, p.pid, { name: "Broken leg", days: 80 });
  const after = playerTradeValue(L, p, 4);
  assert.ok(after < before * 0.75, `${after} vs ${before}`);
  p.injury.left = 2;
  assert.ok(playerTradeValue(L, p, 4) > before * 0.97);
});

test("over a season teams get hurt at a steady rate and always dress healthy players", () => {
  const L = createLeague({ dex, seed: 72, userTid: -1 });
  let worst = 0;
  while (L.phase === "regular") {
    playDay(L);
    for (const t of L.teams) {
      for (const pid of slots(t)) if (pid != null) assert.ok(!L.players[pid].injury, `${t.abbr} dresses someone hurt`);
      worst = Math.max(worst, roster(L, t.tid).filter((p) => p.injury).length);
    }
  }
  const hurt = L.games.flatMap((g) => g.injuries);
  const perTeam = hurt.length / L.teams.length;
  assert.ok(perTeam > 8 && perTeam < 25, `${perTeam} injuries per team`);
  assert.ok(worst <= 10, `a team had ${worst} hurt at once`);
  assert.ok(
    hurt.some((x) => x.period == null),
    "goalies get hurt too",
  );
});

test("injured reserve's cap relief pays for injury cover, which goes when the injured are back", () => {
  const L = fresh();
  const tid = 6;
  const r = roster(L, tid);
  // Fill the team to the brim, then lose five skaters for a while.
  r[0].contract.amount += capFor(L) - payroll(L, tid);
  assert.equal(payroll(L, tid), capFor(L));
  const hurt = r.filter((p) => p.pos !== "G").slice(1, 6);
  for (const p of hurt) injure(L, p.pid, { name: "Separated shoulder", days: 10 });
  const cover = roster(L, tid).filter((p) => p.contract?.cover);
  assert.ok(cover.length >= 2, `${cover.length} signed as cover`);
  assert.ok(payroll(L, tid) > capFor(L), "over the cap on relief");
  assert.ok(overCap(L, tid) <= 0, "but within it");
  assert.ok(roster(L, tid).filter((p) => !p.injury).length >= DRESSED);
  days(L, 12);
  assert.ok(
    cover.every((p) => p.tid !== tid),
    "the cover is gone",
  );
  assert.ok(payroll(L, tid) <= capFor(L));
  assert.ok(!(L.teams[tid].dead ?? []).some((d) => cover.some((p) => p.pid === d.pid)), "with no dead money");
});

test("you can sign injury cover on relief, and must get under the cap when he's back", () => {
  const L = fresh();
  const mine = roster(L, 0);
  mine[0].contract.amount += capFor(L) - payroll(L, 0);
  const out = mine.find((p) => p.pos !== "G" && p.contract.amount > 2000);
  injure(L, out.pid, { name: "Broken hand", days: 9 });
  assert.equal(placeOnIR(L, out.pid).ok, true);
  const free = L.players
    .filter((p) => p.tid === FREE_AGENT && !p.injury && !p.legendary)
    .find((p) => faAsk(L, p) <= out.contract.amount);
  const res = signPlayer(L, free.pid);
  assert.equal(res.ok, true, res.why);
  assert.equal(res.cover, true);
  assert.equal(free.contract.cover, true);
  assert.equal(free.contract.exp, L.season);
  assert.equal(canPlay(L).ok, true);
  days(L, 9);
  assert.equal(out.injury, undefined);
  assert.match(canPlay(L).why, /over the cap|at most 23/);
  assert.equal(releasePlayer(L, free.pid).ok, true);
  assert.equal(canPlay(L).ok, true);
  assert.ok(!(L.teams[0].dead ?? []).some((d) => d.pid === free.pid));
});
