import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createLeague, FREE_AGENT, RESERVE } from "../src/league.js";
import { playDay, signPlayer, releasePlayer } from "../src/season.js";
import { startNextSeason } from "../src/offseason.js";
import { callUpPlayer } from "../src/draft.js";
import { RULES } from "../src/ratings.js";
import {
  capFor,
  minSalary,
  maxSalary,
  marketValue,
  playerValue,
  rookieSalary,
  payroll,
  canAfford,
  expiring,
  resignPlayer,
  underContract,
  deadMoney,
  money,
  LEGENDARY_MARKUP,
  ROOKIE,
} from "../src/contracts.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url), "utf8"));
const league = (seed = 61, userTid = 0) => createLeague({ dex, seed, userTid });
const playToCup = (L) => {
  while (L.phase !== "done") playDay(L);
  return L;
};

test("the cap starts at $95M and rises 3% a season, with a $0.8M minimum and a $19M maximum", () => {
  const L = league();
  assert.equal(capFor(L, 2026), 95_000);
  assert.equal(capFor(L, 2027), 97_900);
  assert.equal(capFor(L, 2036), Math.round((95_000 * 1.03 ** 10) / 100) * 100);
  assert.equal(minSalary(L, 2026), 800);
  assert.equal(maxSalary(L, 2026), 19_000);
  assert.equal(money(95_000), "$95M");
  assert.equal(money(1_250), "$1.25M");
  assert.equal(money(950), "$950K");
});

test("a better player asks more, from the minimum up to the maximum, and Legendaries ask 30% more", () => {
  const L = league();
  const free = L.players.filter((p) => p.tid >= 0 || p.tid === FREE_AGENT);
  const byValue = [...free].sort((a, b) => playerValue(a) - playerValue(b));
  let last = 0;
  for (const p of byValue.filter((x) => !x.legendary)) {
    const ask = marketValue(L, p);
    assert.ok(ask >= last, `${p.name} asks less than a worse player`);
    assert.ok(ask >= minSalary(L) && ask <= maxSalary(L));
    last = ask;
  }
  assert.equal(marketValue(L, byValue[0]), minSalary(L));
  assert.equal(marketValue(L, byValue.at(-1)), maxSalary(L));
  const legend = free.find((p) => p.legendary && marketValue(L, { ...p, legendary: false }) < maxSalary(L) / 2);
  const plain = marketValue(L, { ...legend, legendary: false });
  assert.ok(Math.abs(marketValue(L, legend) - plain * LEGENDARY_MARKUP) <= 10);
});

test("rookie deals run three seasons on a slot scale: about $3.8M first overall, the minimum by round three", () => {
  const L = league();
  const at = (round, pick) => rookieSalary(L, { draft: { round, pick } });
  assert.ok(Math.abs(at(1, 1) - 3_800) <= 10);
  for (let n = 2; n <= 64; n++) {
    const prev = at(Math.ceil((n - 1) / 32), ((n - 2) % 32) + 1);
    assert.ok(at(Math.ceil(n / 32), ((n - 1) % 32) + 1) <= prev);
  }
  assert.equal(at(3, 1), minSalary(L));
  assert.equal(at(7, 32), minSalary(L));
  assert.equal(ROOKIE.years, 3);
});

test("a new league gives every rostered player a contract, staggered, with every team under the cap", () => {
  const L = league();
  for (const t of L.teams) {
    const roster = L.players.filter((p) => p.tid === t.tid);
    assert.ok(roster.every((p) => p.contract && p.contract.exp >= L.season && p.contract.exp < L.season + 5));
    assert.ok(payroll(L, t.tid) <= capFor(L), `${t.abbr} is over the cap`);
    assert.ok(roster.filter((p) => p.contract.exp === L.season).length >= 4, `${t.abbr} has nobody coming up`);
  }
  assert.ok(L.players.filter((p) => p.tid < 0).every((p) => !p.contract));
});

test("you can't sign past the cap, and you always keep room to fill your roster at the minimum", () => {
  const L = league();
  const mine = () => L.players.filter((p) => p.tid === 0);
  releasePlayer(L, mine().at(-1).pid);
  const star = L.players
    .filter((p) => p.tid === FREE_AGENT && !p.legendary)
    .sort((a, b) => marketValue(L, b) - marketValue(L, a))[0];
  // Spend the cap down to just below his ask.
  const room = capFor(L) - payroll(L, 0);
  mine()[0].contract.amount += room - marketValue(L, star) + 10;
  assert.equal(canAfford(L, 0, marketValue(L, star)), false);
  const res = signPlayer(L, star.pid);
  assert.equal(res.ok, false);
  assert.match(res.why, /under the cap/);
  assert.equal(star.tid, FREE_AGENT);
  // A team at 19 under contract must keep a minimum salary free for the 20th.
  const amount = capFor(L) - payroll(L, 0) - minSalary(L);
  assert.equal(canAfford(L, 0, amount, { adds: 0 }), RULES.minRoster - underContract(L, 0).length <= 0);
});

test("a released player's salary still counts until his contract would have ended", () => {
  const L = league();
  const p = L.players.find((x) => x.tid === 0 && x.contract.exp > L.season);
  const before = payroll(L, 0);
  const { amount, exp } = p.contract;
  assert.equal(releasePlayer(L, p.pid).ok, true);
  assert.equal(p.contract, null);
  assert.equal(payroll(L, 0), before);
  assert.deepEqual(deadMoney(L, 0), [{ pid: p.pid, amount, exp }]);
  assert.equal(deadMoney(L, 0, exp + 1).length, 0, "it's off the books after the season his contract ended");
});

test("you re-sign the players you want once the season is over; the rest leave as free agents", () => {
  const L = league(62);
  const due = () => expiring(L, 0).sort((a, b) => a.age - b.age || a.pid - b.pid);
  assert.equal(resignPlayer(L, due()[0].pid).ok, false, "not during the season");
  playToCup(L);
  const [keep, walk] = due();
  const res = resignPlayer(L, keep.pid);
  assert.equal(res.ok, true);
  assert.equal(keep.contract.exp, L.season + res.years);
  assert.equal(keep.contract.amount, res.amount);
  assert.ok(!expiring(L, 0).includes(keep));
  startNextSeason(L);
  if (keep.age < 30) assert.equal(keep.tid, 0, "the re-signed player stays");
  assert.notEqual(walk.tid, 0, "the other walked");
  assert.ok(walk.tid === FREE_AGENT || walk.retired || walk.contract.exp > L.season - 1);
  assert.ok(L.news.some((n) => n.text.includes("left as a free agent")));
});

test("over a summer CPU teams re-sign their best players, fill their rosters and stay under the cap", () => {
  const L = playToCup(league(63, -1));
  const due = new Map(L.teams.map((t) => [t.tid, expiring(L, t.tid)]));
  startNextSeason(L);
  let kept = 0;
  let walked = 0;
  for (const t of L.teams) {
    const roster = L.players.filter((p) => p.tid === t.tid);
    assert.ok(roster.length >= RULES.minRoster && roster.length <= RULES.rosterMax);
    assert.ok(payroll(L, t.tid) <= capFor(L), `${t.abbr} is over the cap`);
    assert.ok(roster.every((p) => p.contract && p.contract.exp >= L.season));
    for (const p of due.get(t.tid)) {
      if (p.tid === t.tid) kept++;
      else if (p.tid !== -2) walked++;
    }
  }
  assert.ok(kept > 0 && walked > 0, `${kept} kept, ${walked} walked`);
});

test("a prospect called up signs a three-season rookie deal at his draft slot", () => {
  const L = playToCup(league(64));
  startNextSeason(L);
  const prospect = L.players.find((p) => p.tid === RESERVE && p.rights === 0);
  const cut = L.players.filter((p) => p.tid === 0).sort((a, b) => a.contract.amount - b.contract.amount)[0];
  if (L.players.filter((p) => p.tid === 0).length >= RULES.rosterMax) releasePlayer(L, cut.pid);
  const salary = rookieSalary(L, prospect);
  assert.equal(callUpPlayer(L, prospect.pid).ok, true);
  assert.deepEqual(prospect.contract, { amount: salary, exp: L.season + 2, rookie: true });
});
