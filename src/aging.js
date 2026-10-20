// Getting older, and the summer's roster moves: past his position's peak age
// a player wears down, Speed first. Veterans retire, stars later than the
// rest. A retired Legendary's species returns a few seasons later as a new
// free agent. Teams fill their rosters from their reserve lists and free
// agency, prospects who never made it are let go, and free agents nobody
// signed for a whole season leave the league.

import { speciesById, DEX } from "./dex.js";
import { makePlayer, updateSkills, dexById, RETIRED, RESERVE, FREE_AGENT, DRAFT_QUOTA } from "./league.js";
import { bestOvr, potential } from "./growth.js";
import { RULES, POSITIONS } from "./ratings.js";
import { points } from "./season.js";
import { reserveList, releaseRights, callUp, prospectValue, RESERVE_MAX, RESERVE_AGE_LIMIT } from "./draft.js";

// The age a player is at his best, by position, as in ZenGM Hockey.
export const PEAK_AGE = { G: 31, D: 29, C: 28, W: 27 };

export const peakAge = (p) => PEAK_AGE[p.pos ?? p.natural];

// Wear is the share of his other stats a player has lost; Speed loses twice
// as much. Each season past the peak takes a little more than the last.
export const WEAR = { first: 0.0075, step: 0.005, max: 0.3 };

export const wearForSeason = (yearsPast) => (yearsPast <= 0 ? 0 : WEAR.first + WEAR.step * (yearsPast - 1));

// Called once a year, after the birthday.
export const wearDown = (p) => {
  const add = wearForSeason(p.age - peakAge(p));
  if (!add) return false;
  p.wear = Math.min(WEAR.max, (p.wear ?? 0) + add);
  updateSkills(p, speciesById[p.species]);
  return true;
};

// Nobody plays past this age.
export const MAX_AGE = 41;

// The chance a player retires this summer, at his new age. It starts at 30,
// rises steeply, falls for stars and rises for anyone without a team.
export const retirementChance = (p) => {
  if (p.age >= MAX_AGE) return 1;
  if (p.age < 30) return 0;
  let chance = 0.045 * 1.4 ** (p.age - 30);
  const ovr = bestOvr(p.ovrs);
  if (ovr >= 75) chance *= 0.4;
  else if (ovr >= 65) chance *= 0.7;
  if (p.tid === -1) chance *= 2;
  return Math.min(1, chance);
};

// A retired Legendary's species sits out this many seasons, then a new one
// appears as a free agent.
export const LEGEND_RETURN_SEASONS = 3;

const newcomer = (state, species, age, rng) => {
  const pid = state.players.length;
  const p = makePlayer(species, pid, rng, dexById(DEX), age);
  state.players.push(p);
  return p;
};

// A free agent nobody signed leaves the league rather than retiring.
// A retired player keeps who he was and his career, and drops what only an
// active player needs, so decades of retirements keep the save small.
const RETIRED_KEEPS = new Set([
  "pid",
  "species",
  "name",
  "num",
  "types",
  "legendary",
  "shiny",
  "age",
  "level",
  "ivs",
  "nature",
  "nickname",
  "evolutions",
  "tid",
  "pos",
  "natural",
  "ovrs",
  "career",
  "draft",
  "retired",
]);

const NEVER_PLAYED_KEEPS = new Set([
  "pid",
  "species",
  "name",
  "nickname",
  "shiny",
  "age",
  "evolutions",
  "tid",
  "career",
  "draft",
  "retired",
]);

const retire = (state, p, { left = false } = {}) => {
  const tid = p.tid;
  p.retired = { season: state.season, age: p.age, tid, ...(left ? { left } : {}) };
  p.tid = RETIRED;
  // Someone who leaves without ever playing a game keeps only his name.
  const keeps = left && !p.career.length ? NEVER_PLAYED_KEEPS : RETIRED_KEEPS;
  for (const k of Object.keys(p)) if (!keeps.has(k)) delete p[k];
  if (p.legendary)
    (state.legendReturns ??= []).push({ species: p.species, season: state.season + 1 + LEGEND_RETURN_SEASONS });
  return tid;
};

// How many players a team carries at each position, against what it wants.
const needs = (roster) => {
  const have = Object.fromEntries(POSITIONS.map((pos) => [pos, 0]));
  for (const p of roster) have[p.pos]++;
  return POSITIONS.map((pos) => ({ pos, short: DRAFT_QUOTA[pos] - have[pos] })).sort(
    (a, b) => b.short - a.short || POSITIONS.indexOf(b.pos) - POSITIONS.indexOf(a.pos),
  );
};

const jerseyFor = (roster) => {
  const used = new Set(roster.map((x) => x.jersey));
  let n = 2;
  while (used.has(n)) n++;
  return n;
};

// The best player a team can add at the position it's shortest at: a free
// agent, or (for CPU teams) one of its own prospects.
const signFor = (state, tid, roster, fromReserve) => {
  const { pos } = needs(roster)[0];
  const legends = roster.filter((p) => p.legendary).length;
  let best = null;
  for (const p of state.players) {
    const mine = fromReserve && p.tid === RESERVE && p.rights === tid;
    if ((p.tid !== FREE_AGENT && !mine) || (p.legendary && legends >= RULES.maxLegendariesPerTeam)) continue;
    if (!best || p.ovrs[pos] > best.ovrs[pos] || (p.ovrs[pos] === best.ovrs[pos] && p.pid < best.pid)) best = p;
  }
  if (!best) return null;
  if (best.tid === RESERVE) callUp(state, best.pid, tid);
  Object.assign(best, { tid, pos, jersey: jerseyFor(roster), faSince: null });
  roster.push(best);
  return best;
};

// Teams short of players add the best free agents (or their own prospects)
// at the positions they need, one at a time in turn, weakest team first. CPU
// teams fill their rosters; your team is only topped up to the minimum, from
// free agents, so your reserve list is yours to manage.
export const fillRosters = (state) => {
  const order = [...state.teams].sort((a, b) => points(a.record) - points(b.record) || a.tid - b.tid);
  const rosters = new Map(order.map((t) => [t.tid, state.players.filter((p) => p.tid === t.tid)]));
  const target = (tid) => (tid === state.userTid ? RULES.minRoster : RULES.rosterMax);
  const signed = [];
  for (let more = true; more;) {
    more = false;
    for (const t of order) {
      const roster = rosters.get(t.tid);
      if (roster.length >= target(t.tid)) continue;
      const p = signFor(state, t.tid, roster, t.tid !== state.userTid);
      if (p) {
        signed.push(p);
        more = true;
      }
    }
  }
  return signed;
};

// A CPU team calls up a prospect who already beats its weakest player at his
// position, and lets that player go. At most a few a summer.
const MAX_CALL_UPS = 3;
export const promoteProspects = (state, tid) => {
  const moves = [];
  const prospects = reserveList(state, tid).sort((a, b) => bestOvr(b.ovrs) - bestOvr(a.ovrs) || a.pid - b.pid);
  for (const p of prospects) {
    if (moves.length >= MAX_CALL_UPS) break;
    const roster = state.players.filter((x) => x.tid === tid);
    const pos = p.natural;
    const weakest = roster.filter((x) => x.pos === pos).sort((a, b) => a.ovrs[pos] - b.ovrs[pos] || b.pid - a.pid)[0];
    if (!weakest || p.ovrs[pos] <= weakest.ovrs[pos] + 1) continue;
    if (p.legendary && !weakest.legendary && roster.some((x) => x.legendary)) continue;
    Object.assign(weakest, { tid: FREE_AGENT, jersey: null, faSince: state.season });
    callUp(state, p.pid, tid);
    p.pos = pos;
    moves.push({ up: p, down: weakest });
  }
  return moves;
};

const teamLabel = (state, tid) => (tid >= 0 ? ` (${state.teams[tid].abbr})` : "");

// The summer, after everyone's birthday: wear and retirements, prospects too
// old for the reserve list, returning Legendaries, rosters filled and
// prospects called up, reserve lists trimmed, and free agents nobody wanted
// leave the league.
export const agingSummer = (state, rng) => {
  const active = state.players.filter((p) => p.tid !== RETIRED);
  for (const p of active) wearDown(p);

  const retired = [];
  for (const p of active) if (rng.chance(retirementChance(p))) retired.push(p);
  for (const p of retired) retire(state, p);

  const userRetired = retired.filter((p) => p.retired.tid === state.userTid);
  for (const p of userRetired) {
    state.news.unshift({
      season: state.season,
      pid: p.pid,
      text: `${p.name} “${p.nickname}” retired at ${p.age}.`,
    });
  }
  if (retired.length) {
    const star = retired.reduce((a, b) => (bestOvr(b.ovrs) > bestOvr(a.ovrs) ? b : a));
    state.news.unshift({
      season: state.season,
      pid: star.pid,
      text: `${retired.length} players retired, led by ${star.name} “${star.nickname}”${teamLabel(state, star.retired.tid)}.`,
    });
  }

  // Legendaries whose time has come back.
  const due = (state.legendReturns ?? []).filter((r) => r.season <= state.season + 1);
  state.legendReturns = (state.legendReturns ?? []).filter((r) => r.season > state.season + 1);
  for (const r of due) {
    const p = newcomer(state, speciesById[r.species], rng.int(20, 24), rng);
    p.faSince = state.season;
    state.news.unshift({ season: state.season, pid: p.pid, text: `A new ${p.name} has appeared as a free agent.` });
  }

  // CPU teams fill their rosters and call up prospects who are ready. Then
  // prospects too old for a reserve list are let go, and lists are cut to ten.
  const signed = fillRosters(state);
  for (const t of state.teams) if (t.tid !== state.userTid) promoteProspects(state, t.tid);
  const released = [];
  for (const p of state.players.filter((x) => x.tid === RESERVE && x.age >= RESERVE_AGE_LIMIT)) {
    released.push([p, p.rights]);
    releaseRights(state, p);
  }
  for (const t of state.teams) {
    const list = reserveList(state, t.tid);
    if (list.length <= RESERVE_MAX) continue;
    const value = (p) => (t.tid === state.userTid ? potential(p) : prospectValue(state, p));
    list.sort((a, b) => value(b) - value(a) || a.pid - b.pid);
    for (const p of list.slice(RESERVE_MAX)) {
      released.push([p, t.tid]);
      releaseRights(state, p);
    }
  }
  for (const [p] of released.filter(([, tid]) => tid === state.userTid)) {
    state.news.unshift({
      season: state.season,
      pid: p.pid,
      text: `${p.name} “${p.nickname}” left your reserve list${p.age >= RESERVE_AGE_LIMIT ? ` at ${p.age}, too old to stay a prospect` : ", which holds ten"}.`,
    });
  }

  for (const p of signed.filter((x) => x.tid === state.userTid)) {
    state.news.unshift({
      season: state.season,
      pid: p.pid,
      text: `You signed ${p.name} to fill your roster after retirements.`,
    });
  }

  // Free agents nobody signed for a whole season leave the league.
  const gone = state.players.filter((p) => p.tid === FREE_AGENT && p.faSince < state.season);
  for (const p of gone) retire(state, p, { left: true });
  return { retired, signed, released: released.map(([p]) => p), gone };
};
