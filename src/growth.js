// How players grow: experience from games and training camp, levels on each
// species' real growth curve, a hidden potential tier that multiplies XP, and
// evolution by level, by stone after a breakout season, or by friendship after
// three seasons with one team. Trade evolutions arrive with trades.

import { speciesById } from "./dex.js";
import { playerSkills, evolutionMethod } from "./individual.js";
import { POSITIONS, positionRating } from "./ratings.js";
import { updateSkills, autoLines, teamOvr, RETIRED } from "./league.js";

// ---- Experience and levels ----

// Total experience to reach a level, from the games' six growth curves.
export const expForLevel = (n, growth) => {
  if (n <= 1) return 0;
  const n3 = n ** 3;
  switch (growth) {
    case "fast":
      return Math.floor((4 * n3) / 5);
    case "medium":
      return n3;
    case "medium-slow":
      return Math.floor((6 * n3) / 5 - 15 * n * n + 100 * n - 140);
    case "slow":
      return Math.floor((5 * n3) / 4);
    case "erratic":
      if (n < 50) return Math.floor((n3 * (100 - n)) / 50);
      if (n < 68) return Math.floor((n3 * (150 - n)) / 100);
      if (n < 98) return Math.floor((n3 * Math.floor((1911 - 10 * n) / 3)) / 500);
      return Math.floor((n3 * (160 - n)) / 100);
    case "fluctuating":
      if (n < 15) return Math.floor((n3 * (Math.floor((n + 1) / 3) + 24)) / 50);
      if (n < 36) return Math.floor((n3 * (n + 14)) / 50);
      return Math.floor((n3 * (Math.floor(n / 2) + 32)) / 50);
    default:
      throw new Error(`Unknown growth rate ${growth}`);
  }
};

export const MAX_LEVEL = 100;

export const levelForExp = (exp, growth, from = 1) => {
  let level = from;
  while (level < MAX_LEVEL && expForLevel(level + 1, growth) <= exp) level++;
  return level;
};

// The hidden potential tier multiplies every bit of XP, as in All-22.
export const TIERS = [
  { name: "Poké", xp: 1, odds: 0.6 },
  { name: "Great", xp: 1.25, odds: 0.28 },
  { name: "Ultra", xp: 1.5, odds: 0.1 },
  { name: "Master", xp: 2, odds: 0.02 },
];
export const rollTier = (rng) => rng.weighted(TIERS.map((t) => t.odds));

// The fields a player needs to grow, for a new player or an upgraded save.
export const growthFields = (species, level, rng) => {
  const tier = rollTier(rng);
  return {
    exp: expForLevel(level, species.growth),
    tier,
    tierStart: tier,
    loyalty: { tid: -1, seasons: 0 },
    evolutions: [],
    evolveChoices: null,
  };
};

// XP for one game. A regular skater earns about 24,000 a season, enough for
// about three levels around level 50 on a medium curve.
export const XP = {
  perGame: 60,
  perMinute: 8,
  perPoint: 80,
  perWin: 60,
  goaliePerMinute: 4,
  playoffBoost: 1.5,
};

export const skaterGameXp = (line, won) =>
  XP.perGame + (XP.perMinute * line.toi) / 60 + XP.perPoint * (line.g + line.a) + (won ? XP.perWin : 0);

export const goalieGameXp = (goalie, won) =>
  XP.perGame + (XP.goaliePerMinute * goalie.toi) / 60 + (won ? XP.perWin : 0);

// Game XP is scaled by age, so prospects grow and veterans level slowly.
// Low levels cost little XP, so the youngest gain the most levels anyway.
export const ageXpFactor = (age) => (age <= 21 ? 0.5 : age <= 24 ? 0.55 : age <= 27 ? 0.45 : age <= 30 ? 0.25 : 0.1);

// Training camp XP shrinks with age, like All-22.
export const campXp = (age) => (age <= 24 ? 4000 : age <= 27 ? 3000 : age <= 30 ? 1000 : 0);

// The level a typical player reaches by each age under these rules: a rookie
// at 18 and level 10, a season of games worth this much XP before the age
// factor, every camp, and the average potential tier. A new league starts its
// players on this curve, so it begins where it would settle anyway.
export const TYPICAL = { rookieAge: 18, rookieLevel: 10, seasonXp: 20000 };
const AVERAGE_TIER_XP = TIERS.reduce((sum, t) => sum + t.odds * t.xp, 0);
let typicalLevels = null;

export const typicalLevel = (age) => {
  if (!typicalLevels) {
    typicalLevels = [];
    let exp = expForLevel(TYPICAL.rookieLevel, "medium");
    for (let a = TYPICAL.rookieAge; a <= 50; a++) {
      typicalLevels[a] = levelForExp(exp, "medium");
      exp += (campXp(a) + TYPICAL.seasonXp * ageXpFactor(a)) * AVERAGE_TIER_XP;
    }
  }
  return typicalLevels[Math.max(TYPICAL.rookieAge, Math.min(50, age))];
};

// ---- Evolution ----

export const FRIENDSHIP_SEASONS = 3;

// The species a player could evolve into right now. Level evolutions need the
// level; stones need a breakout season; friendship needs three seasons with
// one team and is checked at training camp.
export const eligibleEvolutions = (p, { breakout = false, camp = false } = {}) =>
  (speciesById[p.species].evos ?? []).filter((id) => {
    const to = speciesById[id];
    if (!to) return false;
    const m = evolutionMethod(to);
    if (m.kind === "level") return p.level >= m.level;
    if (m.kind === "stone") return breakout;
    if (m.kind === "friendship") return camp && p.loyalty.seasons >= FRIENDSHIP_SEASONS;
    return false;
  });

export const bestOvr = (ovrs) => Math.max(...POSITIONS.map((pos) => ovrs[pos]));

// What a player would rate at his position as another species.
const ovrAs = (p, id) => {
  const pos = p.pos ?? p.natural;
  return positionRating(playerSkills(speciesById[id], p), pos);
};

const whose = (state, p) =>
  p.tid >= 0 ? ` of the ${state.teams[p.tid].city} ${state.teams[p.tid].name}` : ", a free agent,";

export const evolve = (state, p, id) => {
  const from = speciesById[p.species];
  const to = speciesById[id];
  p.evolutions.push({ season: state.season, from: from.id, to: to.id });
  p.species = to.id;
  p.name = to.name;
  p.num = to.num;
  p.types = to.types;
  p.evolveChoices = null;
  // A few lines change growth rate as they evolve (Applin to Dipplin). The
  // player keeps his level, so his XP moves onto the new curve at that level.
  if (to.growth !== from.growth) {
    const lo = expForLevel(p.level, to.growth);
    const hi = p.level < MAX_LEVEL ? expForLevel(p.level + 1, to.growth) - 1 : lo;
    p.exp = Math.min(Math.max(p.exp, lo), hi);
  }
  updateSkills(p, to);
  if (p.tid === state.userTid || bestOvr(p.ovrs) >= 70) {
    state.news.unshift({
      season: state.season,
      pid: p.pid,
      text: `${from.name} “${p.nickname}”${whose(state, p)} evolved into ${to.name}!`,
    });
  }
};

// Evolves a player if he can. Your own players wait for you to pick when a
// line branches; everyone else takes the branch that rates best for them.
// Returns true if the player changed species.
export const tryEvolve = (state, p, ctx) => {
  const options = eligibleEvolutions(p, ctx);
  if (!options.length) return false;
  if (p.tid === state.userTid && options.length > 1) {
    const before = p.evolveChoices ?? [];
    p.evolveChoices = [...new Set([...before, ...options])];
    if (!before.length) {
      state.news.unshift({
        season: state.season,
        pid: p.pid,
        text: `${p.name} “${p.nickname}” is ready to evolve. Pick what into on his card.`,
      });
    }
    return false;
  }
  const pick = options.length === 1 ? options[0] : options.reduce((a, b) => (ovrAs(p, b) > ovrAs(p, a) ? b : a));
  evolve(state, p, pick);
  return true;
};

// You pick a branching evolution for one of your players.
export const chooseEvolution = (state, pid, id) => {
  const p = state.players[pid];
  if (!p.evolveChoices?.includes(id)) throw new Error("That isn't one of his evolutions.");
  evolve(state, p, id);
  refreshTeam(state, p.tid);
};

const refreshTeam = (state, tid, { lines = false } = {}) => {
  if (tid < 0) return;
  const t = state.teams[tid];
  if (lines && tid !== state.userTid) t.lines = autoLines(state.players.filter((p) => p.tid === tid));
  t.ovr = teamOvr(t, state.players);
};

// Adds XP (times the potential tier) and handles any level-up. Returns
// "evolved", "levelled" or null.
export const gainExp = (state, p, xp, ctx = {}) => {
  p.exp += Math.round(xp * TIERS[p.tier].xp);
  const species = speciesById[p.species];
  const level = levelForExp(p.exp, species.growth, p.level);
  if (level === p.level) return null;
  p.level = level;
  updateSkills(p, species);
  return tryEvolve(state, p, ctx) ? "evolved" : "levelled";
};

// After each game: XP for everyone who played, then team ratings (and CPU
// lines after an evolution) catch up.
export const awardGameXp = (state, result) => {
  const boost = result.playoffs ? XP.playoffBoost : 1;
  const won = (t) => result.score[t] > result.score[1 - t];
  const changed = new Map();
  const note = (p, what) => {
    if (what) changed.set(p.tid, changed.get(p.tid) === "evolved" ? "evolved" : what);
  };
  for (const [pid, line] of Object.entries(result.lines)) {
    const p = state.players[pid];
    note(p, gainExp(state, p, skaterGameXp(line, won(line.t)) * boost * ageXpFactor(p.age)));
  }
  for (const [t, g] of result.goalies.entries()) {
    if (g.pid == null) continue;
    const p = state.players[g.pid];
    note(p, gainExp(state, p, goalieGameXp(g, won(t)) * boost * ageXpFactor(p.age)));
  }
  for (const [tid, what] of changed) refreshTeam(state, tid, { lines: what === "evolved" });
};

// ---- Between seasons ----

// Breakouts and busts: the players who beat, or fell furthest short of, what
// their rating predicted. Skaters by points per game, goalies by save
// percentage, each against a straight-line fit on their rating.
export const BREAKOUT_SHARE = 0.05;
// Only young players can move up a tier; anyone's breakout can earn a stone.
export const BREAKOUT_MAX_AGE = 26;

const outliers = (players, x, y) => {
  if (players.length < 10) return { top: [], bottom: [] };
  const xs = players.map(x);
  const ys = players.map(y);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const b = sxx ? sxy / sxx : 0;
  const ranked = players
    .map((p, i) => ({ p, r: ys[i] - (my + b * (xs[i] - mx)) }))
    .sort((u, v) => v.r - u.r || u.p.pid - v.p.pid);
  const n = Math.max(1, Math.round(players.length * BREAKOUT_SHARE));
  return { top: ranked.slice(0, n).map((u) => u.p), bottom: ranked.slice(-n).map((u) => u.p) };
};

export const seasonOutliers = (state) => {
  const skaters = state.players.filter((p) => p.tid >= 0 && p.pos !== "G" && p.stats.gp >= 40);
  const goalies = state.players.filter((p) => p.tid >= 0 && p.pos === "G" && p.stats.gs >= 25);
  const s = outliers(
    skaters,
    (p) => p.ovrs[p.pos],
    (p) => (p.stats.g + p.stats.a) / p.stats.gp,
  );
  const g = outliers(
    goalies,
    (p) => p.ovrs.G,
    (p) => 1 - p.stats.ga / Math.max(1, p.stats.sa),
  );
  return { breakouts: [...s.top, ...g.top], busts: [...s.bottom, ...g.bottom] };
};

// A breakout raises the tier one step. A bust drops it one step, but never
// more than one step below where the player started.
export const applyOutliers = (state, { breakouts, busts }) => {
  for (const p of breakouts) {
    if (p.age <= BREAKOUT_MAX_AGE) p.tier = Math.min(TIERS.length - 1, p.tier + 1);
    if (p.tid === state.userTid) {
      state.news.unshift({
        season: state.season,
        pid: p.pid,
        text: `${p.name} “${p.nickname}” had a breakout season.`,
      });
    }
  }
  for (const p of busts) p.tier = Math.max(0, p.tierStart - 1, p.tier - 1);
};

// Training camp, at the start of a season: friendship counts a season, then
// stone and friendship evolutions, then camp XP and any level-ups. Every team's
// rating catches up, and CPU teams redo their lines.
export const trainingCamp = (state, breakouts = []) => {
  const broke = new Set(breakouts.map((p) => p.pid));
  for (const p of state.players) {
    if (p.tid === RETIRED) continue;
    if (p.tid < 0) p.loyalty = { tid: -1, seasons: 0 };
    else if (p.loyalty.tid === p.tid) p.loyalty.seasons++;
    else p.loyalty = { tid: p.tid, seasons: 1 };
    tryEvolve(state, p, { breakout: broke.has(p.pid), camp: true });
    gainExp(state, p, campXp(p.age));
  }
  for (const t of state.teams) refreshTeam(state, t.tid, { lines: true });
};

// ---- Potential ----

// The final forms a species can still reach.
export const finalForms = (id) => {
  const evos = (speciesById[id].evos ?? []).filter((e) => speciesById[e]);
  return evos.length ? [...new Set(evos.flatMap(finalForms))] : [id];
};

// POT is the best rating the player's final form would have at about level 60
// with his own IVs and nature (or now, if he's already past it), at any
// position. It's never below his current rating.
export const POT_LEVEL = 60;

export const potential = (p) => {
  const level = Math.max(p.level, POT_LEVEL);
  let best = bestOvr(p.ovrs);
  for (const id of finalForms(p.species)) {
    const skills = playerSkills(speciesById[id], { ...p, level });
    for (const pos of POSITIONS) best = Math.max(best, positionRating(skills, pos));
  }
  return best;
};
