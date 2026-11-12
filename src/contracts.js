// Contracts and the cap. Every rostered player has a salary and the last
// season his contract runs. What a player is worth comes from his rating at
// his best position, his age and (while he's young) his POT, measured against
// the rest of the league's rostered players, so salaries keep their meaning
// as the league gets stronger or weaker. Legendaries ask 30% more. The cap is
// hard: a team can never sign, re-sign or call up past it. A released
// player's salary still counts until his contract would have run out.
//
// Money is kept in whole thousands of dollars ($K), so it adds up exactly.

import { RULES } from "./ratings.js";
import { bestOvr, potential } from "./growth.js";
import { hashString } from "./hash.js";

export const CAP = {
  // The cap in the league's first season, and how much it grows each season.
  start: 95_000,
  growth: 0.03,
  // The minimum and maximum salary, as shares of the cap: $0.8M and $19M at $95M.
  minShare: 0.8 / 95,
  maxShare: 19 / 95,
};

export const LEGENDARY_MARKUP = 1.3;

const roundTo = (x, step) => Math.round(x / step) * step;

// The season a contract signed now starts in: next season once the Cup is won.
export const contractYear = (state) => (state.phase === "done" ? state.season + 1 : state.season);

export const capFor = (state, season = contractYear(state)) =>
  roundTo(CAP.start * (1 + CAP.growth) ** (season - (state.capStart ?? season)), 100);
export const minSalary = (state, season) => roundTo(capFor(state, season) * CAP.minShare, 10);
export const maxSalary = (state, season) => roundTo(capFor(state, season) * CAP.maxShare, 10);

// ---- What a player is worth ----

// A young player is paid partly for what he'll become; a veteran for what he
// is, less a little each year past 31.
export const playerValue = (p) => {
  const ovr = bestOvr(p.ovrs);
  const potWeight = p.age <= 22 ? 0.4 : p.age <= 25 ? 0.25 : p.age <= 27 ? 0.1 : 0;
  const v = potWeight ? (1 - potWeight) * ovr + potWeight * potential(p) : ovr;
  return v - Math.max(0, p.age - 31);
};

// The market: what the rostered players are worth, from the 25th percentile
// (the minimum) up, on a curve so stars cost far more than depth players.
// Then one scale for the whole league, set so that if every veteran signed at
// his ask today, the average team would spend the whole cap. Rookie deals are
// bargains, so the veterans' asks rise to make up for them. Deals signed in
// earlier summers, dead money and teams short of room keep real payrolls at
// about 85% to 95% of the cap. Measured once a summer and when a league starts.
export const MARKET = { lo: 0.25, hi: 0.99, curve: 2, payrollShare: 1 };

const askShape = (market, p) => {
  const x = Math.min(1, Math.max(0, (playerValue(p) - market.lo) / Math.max(1, market.hi - market.lo)));
  return x ** MARKET.curve;
};

const askFor = (state, p, shape, scale, season) => {
  const min = minSalary(state, season);
  const max = maxSalary(state, season);
  const ask = (min + (max - min) * shape * scale) * (p.legendary ? LEGENDARY_MARKUP : 1);
  return Math.min(max, Math.max(min, roundTo(ask, 10)));
};

export const measureMarket = (state) => {
  const season = contractYear(state);
  const rostered = state.players.filter((p) => p.tid >= 0);
  const values = rostered.map(playerValue).sort((a, b) => a - b);
  const at = (q) => values[Math.min(values.length - 1, Math.floor(q * values.length))];
  const market = { lo: Math.round(at(MARKET.lo) * 10) / 10, hi: Math.round(at(MARKET.hi) * 10) / 10, scale: 1 };
  const rookies = rostered.filter((p) => p.contract?.rookie && p.contract.exp >= season);
  const veterans = rostered.filter((p) => !rookies.includes(p)).map((p) => [p, askShape(market, p)]);
  const target =
    (MARKET.payrollShare * capFor(state, season) * rostered.length) / RULES.rosterMax -
    rookies.reduce((s, p) => s + p.contract.amount, 0);
  let [lo, hi] = [0.25, 6];
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const total = veterans.reduce((s, [p, shape]) => s + askFor(state, p, shape, mid, season), 0);
    if (total < target) lo = mid;
    else hi = mid;
  }
  market.scale = Math.round(lo * 1000) / 1000;
  state.market = market;
  return market;
};

// What a player asks for a new contract.
export const marketValue = (state, p, season = contractYear(state)) =>
  askFor(state, p, askShape(state.market, p), state.market.scale ?? 1, season);

// How many seasons a player wants: long deals while he's young, short ones
// when he's old, with a little variety of his own.
export const contractYears = (state, p) => {
  const jitter = parseInt(hashString(`${state.seed}:${p.pid}:${state.season}:years`).slice(0, 6), 16) % 3;
  const base = p.age <= 25 ? 3 : p.age <= 29 ? 2 : p.age <= 32 ? 1 : 1;
  return Math.min(p.age >= 33 ? 2 : 5, base + jitter);
};

// ---- Rookie deals ----

// A drafted player signs a three-season rookie deal when he's called up, paid
// by where he was picked: about $3.8M for the first pick, falling to the
// minimum by the end of the second round.
export const ROOKIE = { years: 3, topShare: 3.8 / 95, falloff: 12 };

export const rookieSalary = (state, p, season = contractYear(state)) => {
  const min = minSalary(state, season);
  if (!p.draft?.round || p.draft.round > 2) return min;
  const overall = (p.draft.round - 1) * state.teams.length + p.draft.pick;
  const top = capFor(state, season) * ROOKIE.topShare;
  return Math.max(min, roundTo(min + (top - min) * Math.exp(-(overall - 1) / ROOKIE.falloff), 10));
};

// ---- Signing ----

export const sign = (state, p, amount, years, { rookie = false } = {}) => {
  const start = contractYear(state);
  p.contract = { amount, exp: start + years - 1, ...(rookie ? { rookie: true } : {}) };
  return p.contract;
};

export const signRookie = (state, p) => sign(state, p, rookieSalary(state, p), ROOKIE.years, { rookie: true });

// ---- Payroll ----

// Under contract for a season: rostered players whose deal runs through it.
export const underContract = (state, tid, season = contractYear(state)) =>
  state.players.filter((p) => p.tid === tid && p.contract && p.contract.exp >= season);

export const deadMoney = (state, tid, season = contractYear(state)) =>
  (state.teams[tid].dead ?? []).filter((d) => d.exp >= season);

export const payroll = (state, tid, season = contractYear(state)) =>
  underContract(state, tid, season).reduce((s, p) => s + p.contract.amount, 0) +
  deadMoney(state, tid, season).reduce((s, d) => s + d.amount, 0);

// Whether a team can take on another salary and still afford to fill its
// roster to the minimum with minimum-salary players. adds is how many roster
// spots the move fills (0 for a swap).
export const canAfford = (state, tid, amount, opts) => amount <= spendable(state, tid, opts);

// The most a team can add in one salary and still afford to fill its roster.
// Work it out once when checking many players against the same team.
export const spendable = (state, tid, { adds = 1, season = contractYear(state) } = {}) => {
  const short = Math.max(0, RULES.minRoster - underContract(state, tid, season).length - adds);
  return capFor(state, season) - payroll(state, tid, season) - short * minSalary(state, season);
};

export const capRoom = (state, tid, season = contractYear(state)) =>
  capFor(state, season) - payroll(state, tid, season);

// Releasing a player keeps his salary on the books until his deal would end.
export const releaseContract = (state, p, tid) => {
  const c = p.contract;
  if (c && c.exp >= contractYear(state)) {
    (state.teams[tid].dead ??= []).push({ pid: p.pid, amount: c.amount, exp: c.exp });
  }
  p.contract = null;
};

// Whether a team can release a player and still afford to replace him.
export const canRelease = (state, tid, p) => {
  const season = contractYear(state);
  const left = underContract(state, tid, season).filter((x) => x.pid !== p.pid).length;
  const short = Math.max(0, RULES.minRoster - left);
  return payroll(state, tid, season) + short * minSalary(state, season) <= capFor(state, season);
};

// Contracts that end after this season: the players a team can re-sign.
export const expiring = (state, tid) =>
  state.players.filter((p) => p.tid === tid && p.contract && p.contract.exp <= state.season);

export const resignOffer = (state, p) => ({ amount: marketValue(state, p), years: contractYears(state, p) });

// ---- A new league ----

// Every rostered player gets a contract at his value. Each team's deals are
// staggered from one to five seasons, so every summer some come up. A team
// over the cap trims every salary by the same share to fit, as if its players
// took a little less to play together.
export const FIT_SHARE = 0.97;

export const startContracts = (state) => {
  state.capStart = state.season;
  measureMarket(state);
  for (const t of state.teams) {
    t.dead = [];
    const roster = state.players
      .filter((p) => p.tid === t.tid)
      .sort((a, b) =>
        hashString(`${state.seed}:${a.pid}:deal`).localeCompare(hashString(`${state.seed}:${b.pid}:deal`)),
      );
    roster.forEach((p, i) => sign(state, p, marketValue(state, p), 1 + (i % 5)));
    const cap = capFor(state);
    const total = roster.reduce((s, p) => s + p.contract.amount, 0);
    if (total > cap * FIT_SHARE) {
      const min = minSalary(state);
      const k = (cap * FIT_SHARE - roster.length * min) / (total - roster.length * min);
      for (const p of roster)
        p.contract.amount = Math.max(min, Math.floor((min + (p.contract.amount - min) * k) / 10) * 10);
    }
  }
};

// You re-sign one of your players whose contract ends this season, at his ask.
export const resignPlayer = (state, pid, tid = state.userTid) => {
  const p = state.players[pid];
  if (state.phase !== "done") return { ok: false, why: "Contracts can be re-signed once the season is over." };
  if (p.tid !== tid || !p.contract || p.contract.exp > state.season)
    return { ok: false, why: `${p.name}'s contract isn't up for renewal.` };
  const { amount, years } = resignOffer(state, p);
  if (!canAfford(state, tid, amount))
    return { ok: false, why: `${p.name} asks ${money(amount)}, more than you can fit under next season's cap.` };
  sign(state, p, amount, years);
  const t = state.teams[tid];
  state.news.unshift({
    season: state.season,
    pid,
    text: `The ${t.city} ${t.name} re-signed ${p.name} for ${money(amount)} a season through ${p.contract.exp}.`,
  });
  return { ok: true, amount, years };
};

// $1.25M, $950K.
export const money = (k) =>
  k >= 1000 ? `$${(k / 1000).toFixed(k >= 10_000 ? 1 : 2).replace(/\.?0+$/, "")}M` : `$${k}K`;
