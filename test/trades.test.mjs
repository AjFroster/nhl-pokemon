import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createLeague, updateSkills, RESERVE } from "../src/league.js";
import { playDay } from "../src/season.js";
import { startDraft, runDraft } from "../src/draft.js";
import { speciesById } from "../src/dex.js";
import { makeRng } from "../src/random.js";
import { RULES } from "../src/ratings.js";
import { payroll, capFor, overCap } from "../src/contracts.js";
import {
  TRADE,
  deadlineDay,
  tradeWindow,
  teamAssets,
  teamPicks,
  pickOwner,
  judgeTrade,
  proposeTrade,
  balanceTrade,
  tradeProblem,
  playerTradeValue,
  pickTradeValue,
  tradeEvolutions,
} from "../src/trades.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url), "utf8"));
const base = createLeague({ dex, seed: 91, userTid: 0 });
const fresh = () => structuredClone(base);
const roomy = () => room(fresh(), 0, 1);
const player = (pid) => ({ kind: "player", pid });
const roster = (L, tid) => L.players.filter((p) => p.tid === tid);
const plain = (L, tid) => roster(L, tid).filter((p) => !p.legendary);
const best = (L, tid) =>
  [...plain(L, tid)].sort((a, b) => playerTradeValue(L, b, tid) - playerTradeValue(L, a, tid))[0];
const worst = (L, tid) =>
  [...plain(L, tid)].sort((a, b) => playerTradeValue(L, a, tid) - playerTradeValue(L, b, tid))[0];
// Room under the cap for both teams, as a new league starts with little.
const room = (L, ...tids) => {
  for (const p of L.players) if (tids.includes(p.tid)) p.contract.amount = Math.round(p.contract.amount * 0.6);
  return L;
};
// Turns a player into another species, as if he had always been one.
const become = (p, id) => {
  const s = speciesById[id];
  Object.assign(p, { species: id, name: s.name, num: s.num, types: s.types, legendary: false });
  updateSkills(p, s);
  p.pos = p.natural;
};

test("the CPU turns down a lopsided trade and takes one that favours it", () => {
  const L = roomy();
  const theirStar = best(L, 1);
  const myScrub = worst(L, 0);
  const no = proposeTrade(L, 1, [player(myScrub.pid)], [player(theirStar.pid)]);
  assert.equal(no.ok, false);
  assert.match(no.why, /turned it down flat/);
  assert.equal(theirStar.tid, 1);

  const myStar = best(L, 0);
  const theirScrub = worst(L, 1);
  const yes = proposeTrade(L, 1, [player(myStar.pid)], [player(theirScrub.pid)]);
  assert.equal(yes.ok, true, yes.why);
  assert.equal(myStar.tid, 1);
  assert.equal(theirScrub.tid, 0);
  assert.ok(L.news[0].text.startsWith("Trade:"));
  assert.equal(L.trades.length, 1);
});

test("a trade must fit the cap, the roster limits and the one-Legendary rule", () => {
  const L = fresh();
  const mine = roster(L, 0);
  const theirs = roster(L, 1);
  // Three of theirs for one of mine leaves me over 23.
  const three = theirs.slice(0, 3).map((p) => player(p.pid));
  if (mine.length + 2 > RULES.rosterMax)
    assert.match(tradeProblem(L, { a: 0, b: 1, aGives: [player(mine[0].pid)], bGives: three }), /over the limit/);
  // Giving away four for nothing leaves me under 20 in the season.
  const four = mine.slice(0, mine.length - RULES.minRoster + 1).map((p) => player(p.pid));
  assert.match(tradeProblem(L, { a: 0, b: 1, aGives: four, bGives: [] }), /under the 20/);
  // Two Legendaries.
  const myLegend = mine.find((p) => p.legendary);
  const otherLegend = L.players.find((p) => p.tid > 1 && p.legendary);
  if (myLegend && otherLegend)
    assert.match(
      tradeProblem(L, {
        a: 0,
        b: otherLegend.tid,
        aGives: [player(mine.find((p) => !p.legendary).pid)],
        bGives: [player(otherLegend.pid)],
      }),
      /two Legendaries/,
    );
  // The cap: fill mine to the brim, then take on salary.
  const pricey = [...theirs.filter((p) => !p.legendary)].sort((a, b) => b.contract.amount - a.contract.amount)[0];
  const cheap = [...mine.filter((p) => !p.legendary)].sort((a, b) => a.contract.amount - b.contract.amount)[0];
  mine.find((p) => p !== cheap).contract.amount += capFor(L) - payroll(L, 0);
  assert.match(
    tradeProblem(L, { a: 0, b: 1, aGives: [player(cheap.pid)], bGives: [player(pricey.pid)] }),
    /under the cap/,
  );
  // Someone else's player or pick.
  assert.match(tradeProblem(L, { a: 0, b: 1, aGives: [player(theirs[0].pid)], bGives: [] }), /isn't theirs/);
  const theirPick = teamPicks(L, 1)[0];
  assert.match(tradeProblem(L, { a: 0, b: 1, aGives: [theirPick], bGives: [] }), /isn't theirs/);
});

test("trading closes at the deadline and through the playoffs, and opens again after the Cup", () => {
  const L = fresh();
  assert.equal(tradeWindow(L).ok, true);
  assert.equal(deadlineDay(L), Math.floor(L.schedule.length * TRADE.deadlineShare));
  while (L.day < deadlineDay(L)) playDay(L);
  assert.match(tradeWindow(L).why, /deadline has passed/);
  const offer = { a: 0, b: 1, aGives: [teamPicks(L, 0)[0]], bGives: [] };
  assert.match(tradeProblem(L, offer), /deadline/);
  while (L.phase === "regular") playDay(L);
  assert.match(tradeWindow(L).why, /playoffs/);
  while (L.phase !== "done") playDay(L);
  assert.equal(tradeWindow(L).ok, true);
  // In the summer, a contract that just ran out can't be traded.
  const due = roster(L, 0).find((p) => p.contract.exp === L.season);
  assert.match(tradeProblem(L, { a: 0, b: 1, aGives: [player(due.pid)], bGives: [] }), /contract is up/);
  assert.ok(!teamAssets(L, 0).some((x) => x.pid === due.pid));
});

test("a Kadabra traded becomes an Alakazam, valued that way by the team getting him", () => {
  const L = roomy();
  const p = best(L, 1);
  p.level = 45;
  become(p, "kadabra");
  assert.deepEqual(tradeEvolutions(p), ["alakazam"]);
  assert.ok(playerTradeValue(L, p, 0, { asId: "alakazam" }) > playerTradeValue(L, p, 0));
  const res = proposeTrade(L, 1, [player(best(L, 0).pid)], [player(p.pid)]);
  assert.equal(res.ok, true, res.why);
  assert.equal(p.species, "alakazam");
  assert.equal(p.tid, 0);
  assert.ok(p.evolutions.some((e) => e.from === "kadabra" && e.to === "alakazam"));
  assert.ok(L.news.some((n) => n.text.includes("evolved into Alakazam on the trade")));
});

test("Karrablast only evolves when he's traded for a Shelmet", () => {
  const L = roomy();
  const k = worst(L, 1);
  become(k, "karrablast");
  assert.deepEqual(tradeEvolutions(k, []), []);
  const s = worst(L, 0);
  become(s, "shelmet");
  assert.deepEqual(tradeEvolutions(k, [s]), ["escavalier"]);
  const firsts = teamPicks(L, 0).filter((x) => x.round === 1);
  const res = proposeTrade(L, 1, [player(s.pid), ...firsts], [player(k.pid)]);
  assert.equal(res.ok, true, res.why);
  assert.equal(k.species, "escavalier");
  assert.equal(s.species, "accelgor");
});

test("a traded pick is made by the team that holds it", () => {
  const L = roomy();
  const pick = teamPicks(L, 1).find((x) => x.season === L.season && x.round === 1);
  const res = proposeTrade(L, 1, [player(best(L, 0).pid)], [pick, player(worst(L, 1).pid)]);
  assert.equal(res.ok, true, res.why);
  assert.equal(pickOwner(L, pick.season, 1, 1), 0);
  assert.ok(teamPicks(L, 0).some((x) => x.orig === 1 && x.round === 1 && x.season === L.season));
  assert.equal(teamPicks(L, 0).length, ROUNDS_TIMES_SEASONS + 1);
  while (L.phase !== "done") playDay(L);
  startDraft(L, makeRng(1));
  const slots = L.draft.picks.filter((x) => x.round === 1 && x.tid === 0);
  assert.equal(slots.length, 2);
  assert.ok(slots.some((x) => x.orig === 1));
  assert.equal(L.pickOwners[`${L.season}:1:1`], undefined, "the draft settles its traded picks");
  runDraft(L, { auto: true });
  const got = L.players.find(
    (p) =>
      p.draft?.season === L.season &&
      p.draft.round === 1 &&
      p.rights === 0 &&
      p.draft.pick === slots.find((x) => x.orig === 1).pick,
  );
  assert.ok(got);
  assert.equal(got.tid, RESERVE);
});
const ROUNDS_TIMES_SEASONS = 7 * TRADE.pickSeasons;

test("better picks are worth more, and picks further off are worth less", () => {
  const L = fresh();
  const worstTeam = [...L.teams].sort((a, b) => a.ovr - b.ovr)[0].tid;
  const bestTeam = [...L.teams].sort((a, b) => b.ovr - a.ovr)[0].tid;
  const v = (season, round, orig) => pickTradeValue(L, { kind: "pick", season, round, orig }, 0, { strat: "neutral" });
  assert.ok(v(L.season, 1, worstTeam) > v(L.season, 1, bestTeam));
  assert.ok(v(L.season, 1, worstTeam) > v(L.season, 2, worstTeam));
  assert.ok(v(L.season, 1, worstTeam) > v(L.season + 2, 1, worstTeam));
});

test("asking what would make it work finds something they'll take", () => {
  const L = roomy();
  // Both rosters are full, so picks have to make up the difference.
  const target = [...plain(L, 1)]
    .filter((p) => playerTradeValue(L, p, 1) <= 20)
    .sort((a, b) => playerTradeValue(L, b, 1) - playerTradeValue(L, a, 1))[0];
  const mine = [player(worst(L, 0).pid)];
  assert.equal(judgeTrade(L, 1, mine, [player(target.pid)]).accepts, false);
  const side = balanceTrade(L, 1, mine, [player(target.pid)]);
  assert.ok(side, "something works");
  assert.ok(side.length > mine.length && side.length <= mine.length + 3);
  assert.equal(judgeTrade(L, 1, side, [player(target.pid)]).accepts, true);
});

test("CPU teams trade with each other in the season and every team stays legal", () => {
  const L = createLeague({ dex, seed: 92, userTid: 0 });
  while (L.phase === "regular") playDay(L);
  const cpu = (L.trades ?? []).filter((t) => t.a !== 0 && t.b !== 0);
  assert.ok(cpu.length >= 3, `${cpu.length} CPU trades`);
  for (const t of cpu) {
    assert.ok(t.day < deadlineDay(L));
    // A team out of the race sells to one that isn't, as each stood that day.
    assert.ok(t.strategies.includes("contend"), t.strategies.join(" and "));
  }
  for (const t of L.teams) {
    const r = roster(L, t.tid);
    const active = r.filter((p) => !p.injury?.ir).length;
    assert.ok(r.length >= RULES.minRoster && active <= RULES.rosterMax, `${t.abbr} has ${r.length}`);
    assert.ok(r.filter((p) => p.legendary).length <= 1);
    // Injured reserve's relief can take a team over the cap in the season.
    assert.ok(overCap(L, t.tid) <= 0, `${t.abbr} is over the cap`);
    const slots = [...t.lines.F.flat(), ...t.lines.D.flat(), ...t.lines.G];
    // Every healthy player who's needed is dressed, and nobody hurt is.
    const fit = r.filter((p) => !p.injury).length;
    const dressed = slots.filter((pid) => pid != null);
    assert.ok(
      dressed.every((pid) => L.players[pid].tid === t.tid && !L.players[pid].injury),
      `${t.abbr} lines`,
    );
    assert.equal(dressed.length, Math.min(20, fit), `${t.abbr} dresses ${dressed.length} of ${fit}`);
  }
});
