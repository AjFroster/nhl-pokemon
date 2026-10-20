// Creating a league: every Pokémon becomes a player, then the 32 teams fill
// their rosters in a snake fantasy draft. Whoever is left is a free agent.

import { positionRating, POSITIONS, isLegendary, TEAMS, CONFERENCES, RULES, teamRating } from "./ratings.js";
import { makeRng, randomSeed } from "./random.js";
import { makeSchedule } from "./schedule.js";
import { SAVE_VERSION } from "./save.js";
import { hatch, playerSkills, startingLevel } from "./individual.js";
import { growthFields } from "./growth.js";

// How many of each position a team drafts. Adds up to RULES.rosterMax.
export const DRAFT_QUOTA = { C: 5, W: 8, D: 7, G: 3 };

export const emptyStats = () => ({
  gp: 0,
  g: 0,
  a: 0,
  pm: 0,
  pim: 0,
  sog: 0,
  hit: 0,
  blk: 0,
  toi: 0,
  ppg: 0,
  gwg: 0,
  gs: 0,
  w: 0,
  l: 0,
  otl: 0,
  sa: 0,
  ga: 0,
  so: 0,
});

export const ratePlayer = (p) => {
  p.ovrs = Object.fromEntries(POSITIONS.map((pos) => [pos, positionRating(p.skills, pos)]));
  return p;
};

// Skills and ratings from the player's species, level, IVs and nature.
export const updateSkills = (p, species) => {
  p.skills = playerSkills(species, p);
  ratePlayer(p);
  p.natural = POSITIONS.reduce((a, b) => (p.ovrs[b] > p.ovrs[a] ? b : a));
  return p;
};

export const dexById = (dex) => Object.fromEntries(dex.map((s) => [s.id, s]));

// One player per species, hatched as an individual with a level to match his age.
export const makePlayer = (species, pid, rng, byId) => {
  const age = rng.int(19, 35);
  const individual = hatch(species, { level: startingLevel(species, age, byId, rng), rng });
  const p = {
    pid,
    species: species.id,
    name: species.name,
    num: species.num,
    types: species.types,
    legendary: isLegendary(species),
    age,
    ...individual,
    ...growthFields(species, individual.level, rng),
    tid: -1,
    pos: null,
    jersey: null,
    stats: emptyStats(),
    playoffStats: emptyStats(),
    career: [],
  };
  return updateSkills(p, species);
};

export const makeTeams = () =>
  TEAMS.map((t, tid) => ({
    ...t,
    tid,
    conf: Object.entries(CONFERENCES).find(([, divs]) => divs.includes(t.div))[0],
    lines: null,
    record: { w: 0, l: 0, otl: 0, gf: 0, ga: 0, row: 0, streak: "", last10: [] },
  }));

// Snake draft. Each pick takes the player with the most value over the
// replacement level at a position the team still needs.
export const fantasyDraft = (teams, players, rng) => {
  const avail = players.filter((p) => p.tid === -1);
  const replacement = {};
  for (const pos of POSITIONS) {
    const sorted = avail.map((p) => p.ovrs[pos]).sort((a, b) => b - a);
    replacement[pos] = sorted[Math.min(sorted.length - 1, teams.length * DRAFT_QUOTA[pos])];
  }
  const needs = teams.map(() => ({ ...DRAFT_QUOTA }));
  const legends = teams.map(() => 0);
  const order = rng.shuffle(teams.map((t) => t.tid));
  const rounds = Object.values(DRAFT_QUOTA).reduce((a, b) => a + b, 0);
  const taken = new Set();
  const picks = [];

  for (let round = 0; round < rounds; round++) {
    const roundOrder = round % 2 === 0 ? order : [...order].reverse();
    for (const tid of roundOrder) {
      let best = null;
      for (const p of avail) {
        if (taken.has(p.pid)) continue;
        if (p.legendary && legends[tid] >= RULES.maxLegendariesPerTeam) continue;
        for (const pos of POSITIONS) {
          if (needs[tid][pos] <= 0) continue;
          const value = p.ovrs[pos] - replacement[pos];
          if (!best || value > best.value) best = { p, pos, value };
        }
      }
      if (!best) continue;
      taken.add(best.p.pid);
      needs[tid][best.pos]--;
      if (best.p.legendary) legends[tid]++;
      best.p.tid = tid;
      best.p.pos = best.pos;
      picks.push({ round: round + 1, tid, pid: best.p.pid });
    }
  }
  return picks;
};

const assignJerseys = (team, roster, rng) => {
  const used = new Set(roster.filter((p) => p.jersey != null).map((p) => p.jersey));
  for (const p of roster) {
    if (p.jersey != null) continue;
    let n;
    do n = p.pos === "G" ? rng.pick([1, 29, 30, 31, 33, 34, 35, 39, 40, 41, 70, 72]) : rng.int(2, 98);
    while (used.has(n) && used.size < 90);
    used.add(n);
    p.jersey = n;
  }
};

// Best lineup from a roster, filling each slot with players listed at that position first.
export const autoLines = (roster) => {
  const left = new Set(roster.map((p) => p.pid));
  const take = (pos, n) => {
    const sorted = roster
      .filter((p) => left.has(p.pid))
      .sort((a, b) => (b.pos === pos) - (a.pos === pos) || b.ovrs[pos] - a.ovrs[pos]);
    const chosen = sorted.slice(0, n);
    for (const p of chosen) left.delete(p.pid);
    return chosen.sort((a, b) => b.ovrs[pos] - a.ovrs[pos]).map((p) => p.pid);
  };
  const G = take("G", 2);
  const D = take("D", 6);
  const C = take("C", 4);
  const W = take("W", 8);
  return {
    F: [0, 1, 2, 3].map((i) => [C[i] ?? null, W[2 * i] ?? null, W[2 * i + 1] ?? null]),
    D: [0, 1, 2].map((i) => [D[2 * i] ?? null, D[2 * i + 1] ?? null]),
    G: [G[0] ?? null, G[1] ?? null],
  };
};

// Ratings of the dressed lineup, by slot, for the team strength formula.
export const lineupOvrs = (lines, byPid) => {
  const ovr = (pid, pos) => (pid != null && byPid[pid] ? byPid[pid].ovrs[pos] : 0);
  return {
    C: lines.F.map((l) => ovr(l[0], "C")),
    W: lines.F.flatMap((l) => [ovr(l[1], "W"), ovr(l[2], "W")]),
    D: lines.D.flat().map((pid) => ovr(pid, "D")),
    G: lines.G.map((pid) => ovr(pid, "G")),
  };
};

export const teamOvr = (team, byPid) => teamRating(lineupOvrs(team.lines, byPid));

export const createLeague = ({ dex, seed = randomSeed(), userTid = 0, season = 2026 }) => {
  const rng = makeRng(seed);
  const teams = makeTeams();
  const byId = dexById(dex);
  const players = dex.map((s, i) => makePlayer(s, i, rng, byId));
  const picks = fantasyDraft(teams, players, rng);
  const byPid = players;
  for (const t of teams) {
    const roster = players.filter((p) => p.tid === t.tid);
    assignJerseys(t, roster, rng);
    t.lines = autoLines(roster);
    t.ovr = teamOvr(t, byPid);
  }
  const schedule = makeSchedule(teams, rng);
  const first = players[picks[0].pid];
  const firstTeam = teams[picks[0].tid];
  const news = [
    {
      season,
      text: `The fantasy draft is done. The ${firstTeam.city} ${firstTeam.name} took ${first.name} first overall.`,
    },
  ];
  return {
    version: SAVE_VERSION,
    seed,
    rngState: rng.state,
    season,
    phase: "regular",
    day: 0,
    userTid,
    teams,
    players,
    schedule,
    games: [],
    playoffs: null,
    champion: null,
    history: [],
    news,
  };
};
