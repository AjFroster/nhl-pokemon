// Getting older: past his position's peak age a player wears down, Speed
// first. Veterans retire, stars later than the rest. A retired Legendary's
// species returns a few seasons later as a new free agent. Until the draft
// arrives, every other retirement makes room for a young free agent, and
// teams sign free agents to fill the gaps.

import { speciesById, DEX } from "./dex.js";
import { makePlayer, updateSkills, dexById, RETIRED, DRAFT_QUOTA } from "./league.js";
import { bestOvr } from "./growth.js";
import { RULES, POSITIONS, isLegendary } from "./ratings.js";
import { points } from "./season.js";

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
  let chance = 0.035 * 1.4 ** (p.age - 30);
  const ovr = bestOvr(p.ovrs);
  if (ovr >= 75) chance *= 0.4;
  else if (ovr >= 65) chance *= 0.7;
  if (p.tid === -1) chance *= 2;
  return Math.min(1, chance);
};

// A retired Legendary's species sits out this many seasons, then a new one
// appears as a free agent.
export const LEGEND_RETURN_SEASONS = 3;

const isBaseForm = (s) => !s.prevo || !speciesById[s.prevo];

const FIRST_STAGES = DEX.filter((s) => isBaseForm(s) && !isLegendary(s));

const newcomer = (state, species, age, rng) => {
  const pid = state.players.length;
  const p = makePlayer(species, pid, rng, dexById(DEX), age);
  state.players.push(p);
  return p;
};

const retire = (state, p) => {
  const tid = p.tid;
  p.retired = { season: state.season, age: p.age, tid };
  p.tid = RETIRED;
  p.jersey = null;
  p.evolveChoices = null;
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

const signFor = (state, tid, roster) => {
  const { pos } = needs(roster)[0];
  const legends = roster.filter((p) => p.legendary).length;
  let best = null;
  for (const p of state.players) {
    if (p.tid !== -1 || (p.legendary && legends >= RULES.maxLegendariesPerTeam)) continue;
    if (!best || p.ovrs[pos] > best.ovrs[pos] || (p.ovrs[pos] === best.ovrs[pos] && p.pid < best.pid)) best = p;
  }
  if (!best) return null;
  const used = new Set(roster.map((x) => x.jersey));
  let n = 2;
  while (used.has(n)) n++;
  Object.assign(best, { tid, pos, jersey: n });
  roster.push(best);
  return best;
};

// Teams short of players sign the best free agents at the positions they
// need, one at a time in turn, weakest team first. CPU teams fill their
// rosters; your team is only topped up to the minimum.
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
      const p = signFor(state, t.tid, roster);
      if (p) {
        signed.push(p);
        more = true;
      }
    }
  }
  return signed;
};

const teamLabel = (state, tid) => (tid >= 0 ? ` (${state.teams[tid].abbr})` : "");

// The summer, after everyone's birthday: wear, retirements, returning
// Legendaries and young free agents, then teams fill their rosters.
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
    state.news.unshift({ season: state.season, pid: p.pid, text: `A new ${p.name} has appeared as a free agent.` });
  }

  // Until the draft: one young free agent of a random first-stage species
  // for every other player who retired.
  for (const p of retired) if (!p.legendary) newcomer(state, rng.pick(FIRST_STAGES), rng.int(18, 20), rng);

  const signed = fillRosters(state);
  for (const p of signed.filter((x) => x.tid === state.userTid)) {
    state.news.unshift({
      season: state.season,
      pid: p.pid,
      text: `You signed ${p.name} to fill your roster after retirements.`,
    });
  }
  return { retired, signed };
};
