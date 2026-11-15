import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createLeague, emptyStats, FREE_AGENT } from "../src/league.js";
import { playDay } from "../src/season.js";
import { startNextSeason } from "../src/offseason.js";
import { moodOf, teamMoods, traitsOf, TRAITS, MOOD } from "../src/mood.js";
import { resignOffer, resignPlayer, marketValue, maxSalary, minSalary } from "../src/contracts.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url), "utf8"));
const playToCup = (L) => {
  while (L.phase !== "done") playDay(L);
  return L;
};
// One finished season, shared by the tests that only read it.
const done = playToCup(createLeague({ dex, seed: 71, userTid: 0 }));
const fresh = () => structuredClone(done);
const byPoints = (L) => [...L.teams].sort((a, b) => 2 * b.record.w + b.record.otl - (2 * a.record.w + a.record.otl));
const reason = (m, key) => m.reasons.find((r) => r.key === key)?.value ?? 0;
const withTraits = (L, p, traits) => moodOf(L, { ...p, traits });

test("every player has one or two of the four traits, the same every time", () => {
  const counts = Object.fromEntries(Object.keys(TRAITS).map((k) => [k, 0]));
  let two = 0;
  for (const p of done.players) {
    const traits = traitsOf(done, p);
    assert.ok(traits.length === 1 || traits.length === 2, p.name);
    assert.equal(new Set(traits).size, traits.length);
    assert.deepEqual(traitsOf(done, p), traits);
    for (const k of traits) counts[k]++;
    if (traits.length === 2) two++;
  }
  for (const [k, n] of Object.entries(counts)) assert.ok(n > done.players.length / 6, `${k}: ${n}`);
  const share = two / done.players.length;
  assert.ok(share > 0.28 && share < 0.42, `${share} have two traits`);
});

test("winning lifts mood and losing sinks it, twice as much for a Competitive player", () => {
  const order = byPoints(done);
  const [best, worst] = [order[0], order.at(-1)];
  const star = (t) => done.players.find((p) => p.tid === t.tid);
  const up = withTraits(done, star(best), ["spotlight"]);
  const down = withTraits(done, star(worst), ["spotlight"]);
  assert.ok(reason(up, "winning") > 0 && reason(down, "winning") < 0);
  assert.equal(reason(withTraits(done, star(best), ["competitive"]), "winning"), 2 * reason(up, "winning"));
  assert.equal(reason(withTraits(done, star(worst), ["competitive"]), "winning"), 2 * reason(down, "winning"));
  const champ = done.players.find((p) => p.tid === done.champion);
  assert.equal(reason(withTraits(done, champ, ["loyal"]), "cup"), MOOD.cup);
});

test("ice time moves mood, twice as much for a Spotlight player", () => {
  const t = done.teams[5];
  const skaters = done.players.filter((p) => p.tid === t.tid && p.pos !== "G" && p.stats.gp > 60);
  const perGame = (p) => p.stats.toi / p.stats.gp;
  const forwards = skaters.filter((p) => p.pos !== "D").sort((a, b) => perGame(b) - perGame(a));
  const [top, bottom] = [forwards[0], forwards.at(-1)];
  assert.equal(reason(withTraits(done, top, ["loyal"]), "role"), 1);
  assert.equal(reason(withTraits(done, top, ["spotlight"]), "role"), 2);
  assert.equal(reason(withTraits(done, bottom, ["loyal"]), "role"), -0.5);
  assert.equal(reason(withTraits(done, bottom, ["spotlight"]), "role"), -1);
  const goalies = done.players.filter((p) => p.tid === t.tid && p.pos === "G").sort((a, b) => b.stats.gs - a.stats.gs);
  assert.equal(reason(withTraits(done, goalies[0], ["loyal"]), "role"), 1);
  const L = fresh();
  const benched = L.players[top.pid];
  benched.stats = { ...emptyStats(), gp: 5, toi: 3000 };
  assert.equal(reason(withTraits(L, benched, ["loyal"]), "role"), -1.5);
});

test("an underpaid player is unhappy about it, twice as much with Pay Day, and rookie deals don't count", () => {
  const L = fresh();
  const p = L.players.find((x) => x.tid >= 0 && marketValue(L, x) > 4 * minSalary(L));
  p.contract.amount = Math.round(marketValue(L, p) / 2);
  assert.equal(reason(withTraits(L, p, ["loyal"]), "pay"), -1);
  assert.equal(reason(withTraits(L, p, ["payday"]), "pay"), -2);
  p.contract.rookie = true;
  assert.equal(reason(withTraits(L, p, ["payday"]), "pay"), 0);
  delete p.contract.rookie;
  p.contract.amount = marketValue(L, p) * 2;
  assert.equal(reason(withTraits(L, p, ["loyal"]), "pay"), 0.5);
});

test("years with the team lift mood up to a limit, twice as much for a Loyal player", () => {
  const L = fresh();
  const p = L.players.find((x) => x.tid >= 0);
  const at = (seasons, traits) => {
    p.loyalty = { tid: p.tid, seasons };
    return reason(withTraits(L, p, traits), "tenure");
  };
  assert.equal(at(1, ["spotlight"]), 0);
  assert.equal(at(3, ["spotlight"]), 0.6);
  assert.equal(at(3, ["loyal"]), 1.2);
  assert.equal(at(12, ["spotlight"]), MOOD.maxTenure);
  assert.equal(at(12, ["loyal"]), 2 * MOOD.maxTenure);
});

test("a happier player asks less: a small discount at best, never more than 50% over his value", () => {
  const rows = done.teams.flatMap((t) => [...teamMoods(done, t.tid)].map(([pid, m]) => [done.players[pid], m]));
  rows.sort((a, b) => a[1].score - b[1].score);
  let last = Infinity;
  for (const [p, m] of rows) {
    assert.ok(m.markup <= MOOD.maxMarkup && m.markup >= -MOOD.loyalDiscount);
    if (m.traits.includes("payday")) assert.ok(m.markup >= 0, "Pay Day never gives a discount");
    else if (!m.traits.includes("loyal")) {
      assert.ok(m.markup >= -MOOD.discount);
      assert.ok(m.markup <= last, `${p.name} asks more than a less happy player`);
      last = m.markup;
    }
    const offer = resignOffer(done, p, m);
    assert.ok(offer.amount <= maxSalary(done) && offer.amount >= minSalary(done));
    assert.ok(offer.amount <= Math.max(minSalary(done), Math.ceil((offer.base * 1.5) / 10) * 10));
    if (m.markup > 0 && offer.base < maxSalary(done) / 2) assert.ok(offer.amount > offer.base, p.name);
    if (m.markup < 0 && offer.base > 2 * minSalary(done)) assert.ok(offer.amount < offer.base, p.name);
  }
  assert.equal(rows[0][1].markup, MOOD.maxMarkup);
  assert.ok(rows.at(-1)[1].markup < 0);
});

test("a fed-up player won't talk, unless he's Loyal", () => {
  const L = fresh();
  const worst = byPoints(L).at(-1);
  L.userTid = worst.tid;
  const p = L.players.find((x) => x.tid === worst.tid && x.pos !== "G");
  p.contract.exp = L.season;
  p.stats = { ...emptyStats(), gp: 3, toi: 1500 };
  p.loyalty = { tid: p.tid, seasons: 1 };
  p.traits = ["competitive"];
  const m = moodOf(L, p);
  assert.ok(m.score <= MOOD.refuseAt, `${m.score}`);
  assert.equal(m.level.key, "fedup");
  assert.equal(m.refuses, true);
  const res = resignPlayer(L, p.pid);
  assert.equal(res.ok, false);
  assert.equal(res.refused, true);
  assert.match(res.why, /won't talk/);
  assert.equal(p.contract.exp, L.season, "his contract is untouched");

  p.traits = ["loyal", "competitive"];
  const loyal = moodOf(L, p);
  assert.equal(loyal.refuses, false);
  assert.equal(loyal.level.key, "unhappy");
  assert.equal(loyal.markup, MOOD.maxMarkup);
});

test("mood is the same in the summer, once the season's stats are filed in careers", () => {
  const L = fresh();
  const tid = 9;
  const before = teamMoods(L, tid);
  for (const p of L.players.filter((x) => x.tid === tid)) {
    if (p.stats.gp) p.career.push({ season: L.season, tid, pos: p.pos, stats: { ...p.stats } });
    p.stats = emptyStats();
  }
  assert.deepEqual(teamMoods(L, tid), before);
});

test("nothing but pay and tenure counts before a team has played ten games, and free agents have no mood", () => {
  const L = createLeague({ dex, seed: 72, userTid: 0 });
  for (let i = 0; i < 5; i++) playDay(L);
  for (const m of teamMoods(L, 3).values()) assert.ok(m.reasons.every((r) => r.key === "pay" || r.key === "tenure"));
  assert.equal(
    moodOf(
      L,
      L.players.find((p) => p.tid === FREE_AGENT),
    ),
    null,
  );
});

test("a CPU summer re-signs most of the players it wants, loses a fed-up one, and keeps count", () => {
  const L = fresh();
  const cpu = byPoints(L).at(-1);
  L.userTid = cpu.tid === 0 ? 1 : 0;
  const p = L.players.filter((x) => x.tid === cpu.tid && x.age < 30).sort((a, b) => b.ovrs[b.pos] - a.ovrs[a.pos])[0];
  p.contract.exp = L.season;
  p.traits = ["competitive"];
  p.loyalty = { tid: p.tid, seasons: 1 };
  p.contract.amount = minSalary(L);
  assert.equal(moodOf(L, p).refuses, true);
  startNextSeason(L);
  assert.notEqual(p.tid, cpu.tid, "the team's best young player walked");
  const [due, kept, refused] = L.history.at(-1).resigns;
  assert.ok(due > 60 && kept / due > 0.4 && kept / due < 0.95, `${kept} of ${due}`);
  assert.ok(refused >= 1 && refused <= due - kept);
});
