import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  CLASS_SIZE,
  CLASS_SPECIES,
  classWeight,
  ROUNDS,
  RESERVE_MAX,
  RESERVE_AGE_LIMIT,
  FULL_SCOUTS,
  FOG,
  LOTTERY_ODDS,
  LOTTERY_JUMP,
  makeClass,
  draftClass,
  runLottery,
  startDraft,
  runDraft,
  makePick,
  onTheClock,
  draftDone,
  reserveList,
  scoutProspect,
  scoutsLeft,
  scoutOvr,
  scoutPot,
  callUpPlayer,
  releaseProspect,
} from "../src/draft.js";
import { createLeague, FREE_AGENT, RESERVE, PROSPECT, RETIRED } from "../src/league.js";
import { playDay, releasePlayer } from "../src/season.js";
import { startNextSeason } from "../src/offseason.js";
import { agingSummer } from "../src/aging.js";
import { potential } from "../src/growth.js";
import { isLegendary, RULES } from "../src/ratings.js";
import { speciesById } from "../src/dex.js";
import { makeRng } from "../src/random.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url), "utf8"));
const league = (seed = 61, userTid = 0) => createLeague({ dex, seed, userTid });
const playToCup = (L) => {
  for (let i = 0; i < 400 && L.phase !== "done"; i++) playDay(L);
  return L;
};
// One league played to a champion, copied for each test that needs a draft.
const played = playToCup(league(62, 4));
const afterCup = () => structuredClone(played);
const draftRng = (L) => {
  const rng = makeRng(0);
  rng.state = L.rngState;
  return rng;
};

test("the lottery gives the worst team the best odds, and nobody jumps more than ten spots", () => {
  const order = Array.from({ length: 16 }, (_, i) => i);
  const rng = makeRng(5);
  const first = Array(16).fill(0);
  const draws = 20_000;
  for (let i = 0; i < draws; i++) {
    const { result, winners } = runLottery(order, rng);
    first[winners[0]]++;
    assert.deepEqual(
      [...result].sort((a, b) => a - b),
      order,
      "every team still picks once",
    );
    if (order.indexOf(winners[0]) <= LOTTERY_JUMP) assert.equal(result[0], winners[0], "the first winner picks first");
    for (const tid of winners) assert.ok(order.indexOf(tid) - result.indexOf(tid) <= LOTTERY_JUMP);
    // Teams that didn't win keep their order.
    const rest = result.filter((tid) => !winners.includes(tid));
    assert.deepEqual(
      rest,
      [...rest].sort((a, b) => a - b),
    );
  }
  LOTTERY_ODDS.forEach((odds, tid) => {
    const share = first[tid] / draws;
    assert.ok(Math.abs(share - odds) < 0.012, `team ${tid + 1} won the first draw ${share}, odds ${odds}`);
  });
  // A winner from far back moves up only ten spots.
  const far = runLottery(order, { weighted: () => 14 });
  assert.equal(far.result.indexOf(14), 4);
});

test("a draft class is 260 young prospects, with strong lines and shinies rare", () => {
  const L = league();
  const cls = draftClass(L);
  assert.equal(cls.length, CLASS_SIZE);
  for (const p of cls) {
    assert.equal(p.tid, PROSPECT);
    assert.ok(p.age === 18 || p.age === 19, `${p.name} is ${p.age}`);
    const s = speciesById[p.species];
    assert.ok(!isLegendary(s), `${p.name} is Legendary`);
    assert.ok(!s.prevo || !speciesById[s.prevo], `${p.name} isn't a first stage`);
    assert.equal(p.career.length, 0);
    assert.deepEqual(p.draft, { season: L.season, round: null, pick: null, tid: null });
  }
  // No species crowds a class: none is more than 1% of the draw.
  const total = CLASS_SPECIES.reduce((a, x) => a + classWeight(x), 0);
  for (const x of CLASS_SPECIES) assert.ok(classWeight(x) / total < 0.01, x.s.name);
  // Ten more classes to count rare things.
  const rng = makeRng(7);
  for (let i = 0; i < 10; i++) makeClass(L, rng);
  const all = L.players.filter((p) => p.tid === PROSPECT);
  const pseudo = new Set(CLASS_SPECIES.filter((x) => x.pseudo).map((x) => x.s.id));
  const pseudoShare = all.filter((p) => pseudo.has(p.species)).length / all.length;
  assert.ok(pseudoShare < 0.02, `pseudo-legendary lines are ${pseudoShare}`);
  const shinies = all.filter((p) => p.shiny).length;
  assert.ok(shinies >= 4 && shinies <= 32, `${shinies} shinies in ${all.length}`);
  // Lines that end strong are rarer than lines that end around 500.
  const top = Object.fromEntries(CLASS_SPECIES.map((x) => [x.s.id, x.top]));
  const share = (ps, f) => ps.filter(f).length / ps.length;
  const strong = (top) => top >= 560;
  const strongInDex = share(
    CLASS_SPECIES.map((x) => x.top),
    strong,
  );
  const strongInClasses = share(
    all.map((p) => top[p.species]),
    strong,
  );
  assert.ok(strongInClasses < strongInDex / 3, `${strongInClasses} of prospects, ${strongInDex} of lines`);
});

test("your scouts give three prospects a full look a season; the rest are estimates", () => {
  const L = league();
  const cls = draftClass(L);
  const off = cls.map((p) => scoutOvr(L, p, p.natural) - p.ovrs[p.natural]);
  assert.ok(off.every((x) => Math.abs(x) <= FOG));
  assert.ok(off.filter((x) => x !== 0).length > cls.length / 2, "most estimates are off");
  assert.equal(scoutsLeft(L), FULL_SCOUTS);
  for (const p of cls.slice(0, FULL_SCOUTS)) assert.equal(scoutProspect(L, p.pid).ok, true);
  assert.equal(scoutsLeft(L), 0);
  assert.equal(scoutProspect(L, cls[FULL_SCOUTS].pid).ok, false);
  const seen = cls[0];
  assert.equal(scoutOvr(L, seen, seen.natural), seen.ovrs[seen.natural]);
  assert.equal(scoutPot(L, seen), Math.max(potential(seen), ...Object.values(seen.ovrs)));
});

test("the draft order puts non-playoff teams first, after the lottery, and the champion last", () => {
  const L = afterCup();
  const d = startDraft(L, draftRng(L));
  assert.equal(d.picks.length, ROUNDS * 32);
  const round1 = d.picks.filter((x) => x.round === 1).map((x) => x.tid);
  const missed = L.teams.filter((t) => !L.playoffs.rounds[0].some((s) => s.home === t.tid || s.away === t.tid));
  assert.deepEqual(new Set(round1.slice(0, 16)), new Set(missed.map((t) => t.tid)));
  assert.equal(round1[31], L.champion);
  for (let r = 2; r <= ROUNDS; r++)
    assert.deepEqual(
      d.picks.filter((x) => x.round === r).map((x) => x.tid),
      round1,
    );
  assert.match(L.news[0].text, /won the draft lottery/);
  assert.throws(() => startDraft(league(), makeRng(1)), /after the Cup/);
});

test("CPU teams pick until it's your turn; your pick goes on your reserve list", () => {
  const L = afterCup();
  startDraft(L, draftRng(L));
  const slot = runDraft(L);
  assert.equal(slot.tid, L.userTid);
  assert.equal(onTheClock(L), slot);
  const before = L.draft.picks.slice(0, L.draft.next);
  assert.ok(before.every((x) => x.tid !== L.userTid && L.players[x.pid].tid === RESERVE));
  const pick = draftClass(L).sort((a, b) => a.ovrs[a.natural] - b.ovrs[b.natural])[0];
  makePick(L, pick.pid);
  assert.equal(pick.tid, RESERVE);
  assert.equal(pick.rights, L.userTid);
  assert.deepEqual(pick.draft, { season: L.season, round: slot.round, pick: slot.pick, tid: L.userTid });
  assert.throws(() => makePick(L, pick.pid), /isn't available/);
  // The rest, with your scouts picking for you.
  runDraft(L, { auto: true });
  assert.ok(draftDone(L));
  for (const t of L.teams)
    assert.equal(L.players.filter((p) => p.draft?.season === L.season && p.draft.tid === t.tid).length, ROUNDS);
  const undrafted = L.players.filter((p) => p.draft?.season === L.season && p.draft.round == null);
  assert.equal(undrafted.length, CLASS_SIZE - ROUNDS * 32);
  for (const p of undrafted) assert.deepEqual([p.tid, p.faSince], [FREE_AGENT, L.season]);
  assert.equal(draftClass(L).length, 0);
});

test("reserve lists hold ten prospects under 23, trimmed over the summer", () => {
  const L = afterCup();
  startDraft(L, draftRng(L));
  runDraft(L, { auto: true });
  // Pile extra prospects onto your list, one of them too old to stay.
  const extra = L.players.filter((p) => p.tid === FREE_AGENT && p.age <= 20).slice(0, RESERVE_MAX);
  for (const p of extra) Object.assign(p, { tid: RESERVE, rights: L.userTid });
  extra[0].age = RESERVE_AGE_LIMIT - 1;
  const best = reserveList(L, L.userTid).sort((a, b) => potential(b) - potential(a))[0];
  startNextSeason(L);
  for (const t of L.teams) {
    const list = reserveList(L, t.tid);
    assert.ok(list.length <= RESERVE_MAX, `${t.abbr} has ${list.length}`);
    assert.ok(list.every((p) => p.age < RESERVE_AGE_LIMIT));
  }
  assert.equal(extra[0].tid, FREE_AGENT, "too old for the reserve list");
  assert.equal(best.rights, L.userTid, "you keep your best prospect");
  assert.match(L.news.map((n) => n.text).join("\n"), /left your reserve list/);
});

test("you call up a prospect when there's room, or release him", () => {
  const L = afterCup();
  startDraft(L, draftRng(L));
  runDraft(L, { auto: true });
  const [a, b] = reserveList(L, L.userTid);
  const roster = () => L.players.filter((p) => p.tid === L.userTid);
  assert.equal(roster().length, RULES.rosterMax);
  assert.equal(callUpPlayer(L, a.pid).ok, false, "the roster is full");
  releasePlayer(L, roster()[0].pid);
  assert.equal(callUpPlayer(L, a.pid).ok, true);
  assert.equal(a.tid, L.userTid);
  assert.ok(Number.isInteger(a.jersey));
  const lines = L.teams[L.userTid].lines;
  const dressed = [...lines.F.flat(), ...lines.D.flat(), ...lines.G];
  assert.ok(
    dressed.every((pid) => pid != null && L.players[pid].tid === L.userTid),
    "the lines stay full",
  );
  assert.equal(releaseProspect(L, b.pid).ok, true);
  assert.deepEqual([b.tid, b.rights], [FREE_AGENT, null]);
  assert.equal(releaseProspect(L, b.pid).ok, false);
});

test("free agents nobody signs for a season leave the league", () => {
  const L = afterCup();
  const stale = L.players.find((p) => p.tid === FREE_AGENT && p.faSince < L.season);
  const fresh = L.players.find((p) => p.tid === FREE_AGENT && p !== stale);
  fresh.faSince = L.season;
  for (const p of L.players) p.age++;
  const { gone } = agingSummer(L, makeRng(2));
  assert.ok(gone.includes(stale));
  assert.equal(stale.tid, RETIRED);
  assert.equal(stale.retired.left, true);
  assert.ok(fresh.tid !== RETIRED || fresh.retired.left !== true, "a fresh free agent gets a season");
});
