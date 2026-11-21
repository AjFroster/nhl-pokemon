import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createLeague, FREE_AGENT } from "../src/league.js";
import { playDay, signPlayer } from "../src/season.js";
import { openFreeAgency, nextRound, startNextSeason } from "../src/offseason.js";
import { RULES } from "../src/ratings.js";
import { stateHash } from "../src/hash.js";
import { marketValue, contractYears, capFor, payroll, minSalary, maxSalary, playerValue } from "../src/contracts.js";
import { FA, faAsk, faYears, offerScore, placeOffer, withdrawOffer, freeAgents, playRound } from "../src/freeagency.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url), "utf8"));
const playToCup = (L) => {
  while (L.phase !== "done") playDay(L);
  return L;
};
// One finished season, shared by the tests, each on its own copy.
const done = playToCup(createLeague({ dex, seed: 81, userTid: 0 }));
const fresh = () => structuredClone(done);
const open = () => {
  const L = fresh();
  openFreeAgency(L);
  return L;
};
const byPoints = (L) => [...L.teams].sort((a, b) => 2 * b.record.w + b.record.otl - (2 * a.record.w + a.record.otl));
const priced = (L) =>
  freeAgents(L).filter((p) => !p.legendary && p.left?.tid !== 0 && marketValue(L, p) > 2 * minSalary(L));

test("free agency opens after the season with everyone unsigned on the market, and closes direct signing", () => {
  const L = fresh();
  const free = L.players.find((p) => p.tid === FREE_AGENT);
  assert.match(signPlayer(L, free.pid).why, /bidding rounds/);
  const due = L.players.filter((p) => p.tid === 0 && p.contract.exp <= L.season);
  assert.ok(due.length > 0);
  const fa = openFreeAgency(L);
  assert.equal(L.phase, "done");
  assert.deepEqual([fa.round, fa.over, fa.offers.length], [1, false, 0]);
  assert.equal(fa.pool, freeAgents(L).length);
  assert.ok(fa.pool > 100);
  for (const p of due) assert.equal(p.tid, FREE_AGENT, "your unsigned players walked");
  assert.equal(L.history.at(-1).season, L.season);
  assert.throws(() => openFreeAgency(L));
  assert.match(signPlayer(L, freeAgents(L)[0].pid).why, /bidding rounds/);
});

test("asks fall 7% of the opening price each round, then through the season, where deals run one season", () => {
  const L = open();
  const p = priced(L)[0];
  const full = marketValue(L, p);
  const near = (a, b) => Math.abs(a - b) <= 10;
  for (let round = 1; round <= FA.rounds; round++) {
    L.fa.round = round;
    assert.ok(near(faAsk(L, p), full * (1 - 0.07 * (round - 1))), `round ${round}`);
    assert.equal(faYears(L, p), contractYears(L, p));
  }
  L.fa.over = true;
  assert.ok(near(faAsk(L, p), full * 0.7));

  const S = createLeague({ dex, seed: 82, userTid: 0 });
  const q = S.players.filter((x) => x.tid === FREE_AGENT).sort((a, b) => marketValue(S, b) - marketValue(S, a))[0];
  assert.ok(near(faAsk(S, q), marketValue(S, q) * 0.7));
  assert.equal(faYears(S, q), 1);
  S.day = S.schedule.length / 2;
  assert.ok(near(faAsk(S, q), marketValue(S, q) * 0.55));
  S.phase = "playoffs";
  assert.ok(near(faAsk(S, q), marketValue(S, q) * 0.4));
  const cheap = S.players.find((x) => x.tid === FREE_AGENT && marketValue(S, x) === minSalary(S));
  assert.equal(faAsk(S, cheap), minSalary(S), "never under the minimum");
});

test("a Pay Day player takes the most money, a Competitive one takes the contender", () => {
  const L = open();
  const order = byPoints(L);
  const [best, worst] = [order[0].tid, order.at(-1).tid];
  const p = priced(L)[0];
  const ask = faAsk(L, p);
  const years = contractYears(L, p);
  const contender = { tid: best, amount: ask, years, pos: p.natural };
  const rich = { tid: worst, amount: Math.round(ask * 1.15), years, pos: p.natural };
  // The same empty roster for both, so only money and winning differ.
  const pick = (traits) => {
    const q = { ...p, traits };
    return offerScore(L, q, contender, []).score > offerScore(L, q, rich, []).score ? "contender" : "rich";
  };
  assert.equal(pick(["payday"]), "rich");
  assert.equal(pick(["competitive"]), "contender");
  assert.equal(pick(["spotlight"]), "contender", "this gap in the standings is worth more than 15%");
  const even = { ...rich, tid: best };
  assert.ok(offerScore(L, p, even, []).score > offerScore(L, p, contender, []).score, "more money always helps");
});

test("a Spotlight player wants the bigger role, and a Loyal one the years he asked for", () => {
  const L = open();
  const p = priced(L)[0];
  const ask = faAsk(L, p);
  const years = contractYears(L, p);
  const tid = 5;
  const pos = p.natural;
  const crowd = Array.from({ length: 10 }, () => ({ pos, ovrs: { [pos]: 99 } }));
  const offer = { tid, amount: ask, years, pos };
  const role = (traits, roster) => offerScore(L, { ...p, traits }, offer, roster).parts.role;
  assert.equal(role(["payday"], []), 1);
  assert.equal(role(["spotlight"], []), 2);
  assert.ok(role(["payday"], crowd) < 0);
  assert.equal(role(["spotlight"], crowd), 2 * role(["payday"], crowd));
  const off = { ...offer, years: years === 1 ? 3 : years - 1 };
  const yearsPart = (traits, o) => offerScore(L, { ...p, traits }, o, []).parts.years;
  assert.equal(yearsPart(["payday"], offer), 0);
  assert.ok(yearsPart(["payday"], off) < 0);
  assert.equal(yearsPart(["loyal"], off), 2 * yearsPart(["payday"], off));
});

test("your offer wins a bidding war when it's the best one, and a low offer waits for the ask to fall", () => {
  const L = open();
  // Make room, then go well over the ask for the best player who isn't a Legendary.
  for (const p of L.players.filter((x) => x.tid === 0).slice(0, 4)) p.contract.amount = minSalary(L);
  const [star, other] = priced(L).sort((a, b) => playerValue(b) - playerValue(a));
  const ask = faAsk(L, star);
  const res = placeOffer(L, star.pid, Math.min(maxSalary(L), Math.round(ask * 1.4)), contractYears(L, star));
  assert.equal(res.ok, true);
  assert.equal(res.meetsAsk, true);
  const low = placeOffer(L, other.pid, Math.round(faAsk(L, other) * 0.75), contractYears(L, other));
  assert.equal(low.ok, true);
  assert.equal(low.meetsAsk, false);
  const signed = nextRound(L);
  const mine = signed.find((s) => s.pid === star.pid);
  assert.equal(mine.tid, 0);
  assert.equal(star.tid, 0);
  assert.equal(star.contract.amount, res.amount);
  assert.ok(L.teams[0].lines.F.flat().concat(L.teams[0].lines.D.flat(), L.teams[0].lines.G).includes(star.pid));
  assert.match(L.news.map((n) => n.text).join("\n"), new RegExp(`You signed ${star.name} for`));
  assert.equal(L.fa.round, 2);
  assert.equal(L.fa.last.round, 1);
  // The low offer didn't sign him in round one. It stands unless someone else took him.
  assert.notEqual(other.tid, 0);
  assert.equal(
    L.fa.offers.some((o) => o.pid === other.pid),
    other.tid === FREE_AGENT,
  );
  while (!L.fa.over) {
    const askNow = faAsk(L, other);
    const was = other.tid;
    nextRound(L);
    if (was === FREE_AGENT && other.tid === 0)
      assert.ok(low.amount >= askNow, "he only takes it once it meets his ask");
  }
  if (other.tid === 0) assert.equal(other.contract.amount, low.amount);
  else assert.notEqual(other.tid, FREE_AGENT, "someone else got him first");
});

test("offers must fit: the cap, the roster, one Legendary, and nobody who just left you", () => {
  const L = open();
  const p = priced(L)[0];
  assert.match(placeOffer(L, p.pid, 100, 2).why, /Offers run from/);
  assert.match(placeOffer(L, p.pid, faAsk(L, p), 7).why, /1 to 5 seasons/);
  const mine = L.players.find((x) => x.tid === 0);
  const was = mine.contract.amount;
  mine.contract.amount += capFor(L) - payroll(L, 0) - faAsk(L, p) + 10;
  assert.match(placeOffer(L, p.pid, faAsk(L, p), 2).why, /under the cap/);
  mine.contract.amount = was;
  const walked = freeAgents(L).find((x) => x.left?.tid === 0);
  assert.match(placeOffer(L, walked.pid, minSalary(L), 1).why, /won't sign straight back/);
  if (L.players.some((x) => x.tid === 0 && x.legendary)) {
    const legend = freeAgents(L).find((x) => x.legendary);
    L.players.find((x) => x.tid === 0).contract.amount = minSalary(L);
    assert.match(placeOffer(L, legend.pid, minSalary(L), 1).why, /Legendary|under the cap/);
  }
  const cheap = freeAgents(L).filter((x) => !x.legendary && !x.left && faAsk(L, x) === minSalary(L));
  const spots = RULES.rosterMax - L.players.filter((x) => x.tid === 0).length;
  for (let i = 0; i < spots; i++) assert.equal(placeOffer(L, cheap[i].pid, minSalary(L), 1).ok, true, `offer ${i + 1}`);
  assert.match(placeOffer(L, cheap[spots].pid, minSalary(L), 1).why, /every open roster spot/);
  assert.equal(placeOffer(L, cheap[0].pid, minSalary(L) + 50, 2).ok, true, "changing an offer is fine");
  assert.equal(L.fa.offers.length, spots);
  withdrawOffer(L, cheap[0].pid);
  assert.equal(L.fa.offers.length, spots - 1);
  while (!L.fa.over) nextRound(L);
  assert.match(placeOffer(L, cheap[spots].pid, minSalary(L), 1).why, /isn't open/);
});

test("every round's signings meet the ask and the rules, and every team ends up legal and under the cap", () => {
  const L = open();
  const pool = L.fa.pool;
  let total = 0;
  while (!L.fa.over) {
    const asks = new Map(freeAgents(L).map((p) => [p.pid, faAsk(L, p)]));
    const signed = playRound(L);
    total += signed.length;
    for (const s of signed) {
      assert.ok(s.amount >= asks.get(s.pid), "nobody signs under his ask");
      assert.ok(s.amount <= maxSalary(L));
      assert.notEqual(L.players[s.pid].left?.tid, s.tid, "nobody signs straight back");
    }
    for (const t of L.teams) {
      const roster = L.players.filter((p) => p.tid === t.tid);
      assert.ok(roster.length <= RULES.rosterMax);
      assert.ok(roster.filter((p) => p.legendary).length <= RULES.maxLegendariesPerTeam);
      assert.ok(payroll(L, t.tid) <= capFor(L), `${t.abbr} is over the cap`);
    }
  }
  assert.ok(total > 30, `${total} signed in the rounds`);
  assert.equal(L.fa.signed, total);
  startNextSeason(L);
  assert.equal(L.fa, undefined);
  assert.deepEqual(L.history.at(-1).fa, [pool, total]);
  assert.equal(L.phase, "regular");
  for (const t of L.teams) {
    const n = L.players.filter((p) => p.tid === t.tid).length;
    assert.ok(n >= RULES.minRoster && n <= RULES.rosterMax, `${t.abbr} has ${n}`);
    assert.ok(payroll(L, t.tid) <= capFor(L));
  }
});

test("playing the rounds one at a time without bidding gives the same league as starting the season in one go", () => {
  const [A, B] = [fresh(), fresh()];
  startNextSeason(A);
  openFreeAgency(B);
  while (!B.fa.over) nextRound(B);
  startNextSeason(B);
  assert.equal(stateHash(B), stateHash(A));
});

test("before the bidding CPU teams release a few players clearly worse than the free agents, and still carry them", () => {
  const L = fresh();
  const before = new Map(L.players.map((p) => [p.pid, { tid: p.tid, exp: p.contract?.exp }]));
  openFreeAgency(L);
  const cut = L.players.filter(
    (p) => p.tid === FREE_AGENT && before.get(p.pid).tid >= 0 && before.get(p.pid).exp > L.season,
  );
  assert.ok(cut.length > 0, "some teams made room");
  const perTeam = new Map();
  for (const p of cut) {
    const was = before.get(p.pid);
    assert.notEqual(was.tid, L.userTid, "nobody is released for you");
    assert.ok(!p.legendary && p.age > FA.clearMinAge);
    assert.ok(
      L.teams[was.tid].dead.some((d) => d.pid === p.pid && d.exp === was.exp),
      "his salary still counts",
    );
    perTeam.set(was.tid, (perTeam.get(was.tid) ?? 0) + 1);
  }
  for (const [tid, n] of perTeam) {
    assert.ok(n <= FA.clearMost);
    assert.ok(L.players.filter((p) => p.tid === tid).length >= RULES.minRoster);
    assert.ok(payroll(L, tid) <= capFor(L));
  }
});
