// Free agency. After the re-sign window, every player without a contract goes
// to market for five bidding rounds. Each round every team with roster spots
// makes offers, and each player takes the offer he likes best among those
// that meet his ask: more money, a winning team, a bigger role and the years
// he wants all count, and his traits double the one he cares about. Players
// nobody signs lower their asks each round. Whoever is left after five rounds
// can be signed during the season, for one season, at a price that keeps
// falling.

import { RULES, POSITIONS } from "./ratings.js";
import { FREE_AGENT, DRAFT_QUOTA } from "./league.js";
import {
  marketValue,
  contractYears,
  contractYear,
  minSalary,
  maxSalary,
  spendable,
  canAfford,
  canRelease,
  releaseContract,
  sign,
  playerValue,
  money,
} from "./contracts.js";
import { traitsOf } from "./mood.js";
import { hashString } from "./hash.js";

export const FA = {
  rounds: 5,
  // Asks fall this much of the opening ask each round: 100%, 93%, 86%, 79%, 72%.
  drop: 0.07,
  // Then through the season, from 70% on opening day to 40% by the playoffs.
  seasonStart: 0.7,
  seasonEnd: 0.4,
  // A CPU team makes up to this many offers a round, each up to this far over the ask.
  cpuOffers: 4,
  // It picks among the best few at a position, so teams spread their bids.
  cpuChoices: 6,
  cpuPremium: 0.15,
  // A losing team adds this for each 7 points of points percentage under
  // .560, up to twice, which a little more than makes up for its record.
  losingPremium: 0.06,
  // Before the rounds a CPU team releases up to this many players, each at
  // least this much worse than the 16th-best free agent at his position.
  // Players this young are still growing and stay.
  clearMost: 3,
  clearGap: 4,
  clearDepth: 16,
  clearMinAge: 23,
  // How much each thing is worth to a player choosing between offers.
  perTenPercent: 1,
  winning: 0.5,
  yearsOff: 0.25,
  maxYears: 5,
};

const roundTo = (x, step) => Math.round(x / step) * step;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// The share of his full ask a free agent wants right now.
export const askFactor = (state) => {
  if (state.fa) return state.fa.over ? FA.seasonStart : 1 - FA.drop * (state.fa.round - 1);
  if (state.phase === "regular")
    return FA.seasonStart - (FA.seasonStart - FA.seasonEnd) * (state.day / state.schedule.length);
  // In the playoffs the price has bottomed out. Once the Cup is won the
  // market is closed until free agency opens, at full asks.
  return state.phase === "done" ? 1 : FA.seasonEnd;
};

export const faAsk = (state, p) => {
  const season = contractYear(state);
  return clamp(
    roundTo(marketValue(state, p) * askFactor(state), 10),
    minSalary(state, season),
    maxSalary(state, season),
  );
};

// How long a deal he signs now runs: the years he wants in the summer, one
// season once the season is under way.
export const faYears = (state, p) => (state.fa || state.phase === "done" ? contractYears(state, p) : 1);

export const freeAgents = (state) => state.players.filter((p) => p.tid === FREE_AGENT);

// A player whose contract with a team just ran out won't sign straight back.
export const justLeft = (state, p, tid) => p.left?.tid === tid && p.left.season === state.season;

// How many players a team carries at each position, against what it wants.
export const needs = (roster) => {
  const have = Object.fromEntries(POSITIONS.map((pos) => [pos, 0]));
  for (const p of roster) have[p.pos]++;
  return POSITIONS.map((pos) => ({ pos, short: DRAFT_QUOTA[pos] - have[pos] })).sort(
    (a, b) => b.short - a.short || POSITIONS.indexOf(b.pos) - POSITIONS.indexOf(a.pos),
  );
};

export const jerseyFor = (roster) => {
  const used = new Set(roster.map((x) => x.jersey));
  let n = 2;
  while (used.has(n)) n++;
  return n;
};

// ---- What a player makes of an offer ----

// The role he'd have: where he'd rank at his position on that team.
const roleOn = (roster, p, pos) => {
  const group = (x) => (x === "G" ? "G" : x === "D" ? "D" : "F");
  const better = roster.filter((x) => group(x.pos) === group(pos) && x.ovrs[x.pos] > p.ovrs[pos]).length;
  if (pos === "G") return better === 0 ? 1 : better === 1 ? 0 : -1;
  const [top, mid] = pos === "D" ? [2, 4] : [6, 9];
  return better < top ? 1 : better < mid ? 0 : -0.5;
};

const pointsPct = (t) => {
  const gp = t.record.w + t.record.l + t.record.otl;
  return gp ? (2 * t.record.w + t.record.otl) / (2 * gp) : 0.56;
};

// Higher is better. parts says why, for the player's card and the tests.
export const offerScore = (state, p, offer, roster = state.players.filter((x) => x.tid === offer.tid)) => {
  const cares = new Set(traitsOf(state, p));
  const twice = (trait) => (cares.has(trait) ? 2 : 1);
  const ask = faAsk(state, p);
  const parts = {
    money: (offer.amount / ask - 1) * 10 * FA.perTenPercent * twice("payday"),
    winning: clamp((pointsPct(state.teams[offer.tid]) - 0.56) / 0.07, -2, 2) * FA.winning * twice("competitive"),
    role: roleOn(roster, p, offer.pos ?? p.natural) * twice("spotlight"),
    years: 0 - FA.yearsOff * Math.abs(offer.years - contractYears(state, p)) * twice("loyal"),
  };
  return { score: parts.money + parts.winning + parts.role + parts.years, parts };
};

// ---- Offers ----

// What a CPU team offers this round: the best players it can afford at the
// positions it's short at, for a little over their asks.
export const cpuOffers = (state, tid, pool, asks) => {
  const roster = state.players.filter((p) => p.tid === tid);
  const open = RULES.rosterMax - roster.length;
  if (open <= 0) return [];
  const legendsFull = roster.filter((p) => p.legendary).length >= RULES.maxLegendariesPerTeam;
  let room = spendable(state, tid);
  const max = maxSalary(state);
  const offers = [];
  const wanted = new Set();
  const short = needs(roster).filter((n) => n.short > 0);
  const limit = Math.min(open, FA.cpuOffers);
  // A losing team has to pay more to be chosen, so it does.
  const losing = clamp((0.56 - pointsPct(state.teams[tid])) / 0.07, 0, 2) * FA.losingPremium;
  for (let pass = 0; offers.length < limit && pass < FA.cpuOffers; pass++) {
    for (const want of short) {
      if (offers.length >= limit) break;
      if (want.short <= 0) continue;
      const best = pool
        .filter(
          (p) =>
            !wanted.has(p.pid) && !(p.legendary && legendsFull) && !justLeft(state, p, tid) && asks.get(p.pid) <= room,
        )
        .sort((a, b) => b.ovrs[want.pos] - a.ovrs[want.pos] || a.pid - b.pid)
        .slice(0, FA.cpuChoices);
      if (!best.length) continue;
      const key = `${state.seed}:${state.season}:${state.fa.round}:${tid}:${want.pos}:${pass}`;
      const h = parseInt(hashString(key).slice(0, 8), 16);
      const p = best[h % best.length];
      const premium = (((h >>> 8) % 16) / 15) * FA.cpuPremium + losing;
      const amount = Math.min(room, max, roundTo(asks.get(p.pid) * (1 + premium), 10));
      offers.push({ tid, pid: p.pid, amount, years: contractYears(state, p), pos: want.pos });
      wanted.add(p.pid);
      room -= amount;
      want.short--;
    }
  }
  return offers;
};

const offerProblem = (state, p, tid, amount) => {
  const roster = state.players.filter((x) => x.tid === tid);
  if (roster.length >= RULES.rosterMax) return `Your roster is full at ${RULES.rosterMax}.`;
  if (p.legendary && roster.filter((x) => x.legendary).length >= RULES.maxLegendariesPerTeam)
    return `You already have a Legendary. Teams may carry ${RULES.maxLegendariesPerTeam}.`;
  if (!canAfford(state, tid, amount)) return `${money(amount)} is more than you can fit under the cap.`;
  return null;
};

// You make, or change, an offer to a free agent. It stands until he signs
// somewhere or you withdraw it, so an offer under his ask can win in a later
// round, if nobody else gets him first.
export const placeOffer = (state, pid, amount, years) => {
  const p = state.players[pid];
  const tid = state.userTid;
  if (!state.fa || state.fa.over) return { ok: false, why: "Free agency isn't open." };
  if (p.tid !== FREE_AGENT) return { ok: false, why: `${p.name} isn't a free agent.` };
  if (justLeft(state, p, tid))
    return { ok: false, why: `${p.name} just left when his contract ran out and won't sign straight back.` };
  amount = roundTo(amount, 10);
  if (!(amount >= minSalary(state)) || amount > maxSalary(state))
    return { ok: false, why: `Offers run from ${money(minSalary(state))} to ${money(maxSalary(state))} a season.` };
  if (!(years >= 1 && years <= FA.maxYears) || !Number.isInteger(years))
    return { ok: false, why: `Contracts run from 1 to ${FA.maxYears} seasons.` };
  const others = state.fa.offers.filter((o) => o.pid !== pid);
  if (state.players.filter((x) => x.tid === tid).length + others.length >= RULES.rosterMax)
    return { ok: false, why: "You have an offer out for every open roster spot." };
  const why = offerProblem(state, p, tid, amount);
  if (why) return { ok: false, why };
  state.fa.offers = [...others, { pid, amount, years }];
  return { ok: true, amount, years, meetsAsk: amount >= faAsk(state, p) };
};

export const withdrawOffer = (state, pid) => {
  if (!state.fa) return { ok: false };
  state.fa.offers = state.fa.offers.filter((o) => o.pid !== pid);
  return { ok: true };
};

// ---- The rounds ----

// Before the bidding, a CPU team makes room: it lets go of up to three
// players who are clearly worse than free agents half the league could sign
// at their position. Their salaries still count until their deals end.
export const clearSpace = (state) => {
  const pool = freeAgents(state);
  const bar = Object.fromEntries(
    POSITIONS.map((pos) => {
      const best = pool.map((p) => p.ovrs[pos]).sort((a, b) => b - a);
      return [pos, best[Math.min(best.length, FA.clearDepth) - 1] ?? 0];
    }),
  );
  const released = [];
  for (const t of state.teams) {
    if (t.tid === state.userTid) continue;
    const roster = state.players.filter((p) => p.tid === t.tid);
    const weak = roster
      .filter((p) => !p.legendary && p.age > FA.clearMinAge && bar[p.pos] - p.ovrs[p.pos] >= FA.clearGap)
      .sort((a, b) => bar[b.pos] - b.ovrs[b.pos] - (bar[a.pos] - a.ovrs[a.pos]) || a.pid - b.pid);
    let left = roster.length;
    let n = 0;
    for (const p of weak) {
      if (n >= FA.clearMost || left <= RULES.minRoster) break;
      if (!canRelease(state, t.tid, p)) continue;
      releaseContract(state, p, t.tid);
      Object.assign(p, { tid: FREE_AGENT, jersey: null, faSince: state.season });
      released.push(p);
      left--;
      n++;
    }
  }
  return released;
};

// The market opens: CPU teams make room, then everyone without a contract
// is in round one.
export const openMarket = (state, extra = {}) => {
  clearSpace(state);
  state.fa = { round: 1, over: false, offers: [], last: null, pool: freeAgents(state).length, signed: 0, ...extra };
  return state.fa;
};

// One round: the offers come in, the best players choose first, and asks fall
// for everyone still unsigned. Returns who signed where.
export const playRound = (state) => {
  const fa = state.fa;
  if (!fa || fa.over) return [];
  const pool = freeAgents(state);
  const asks = new Map(pool.map((p) => [p.pid, faAsk(state, p)]));
  const offers = new Map();
  const add = (o) => (offers.get(o.pid) ?? offers.set(o.pid, []).get(o.pid)).push(o);
  for (const t of state.teams) if (t.tid !== state.userTid) cpuOffers(state, t.tid, pool, asks).forEach(add);
  for (const o of fa.offers) add({ ...o, tid: state.userTid, pos: state.players[o.pid].natural, yours: true });

  const rosters = new Map(state.teams.map((t) => [t.tid, state.players.filter((p) => p.tid === t.tid)]));
  const signed = [];
  const order = pool.filter((p) => offers.has(p.pid)).sort((a, b) => playerValue(b) - playerValue(a) || a.pid - b.pid);
  for (const p of order) {
    const ask = asks.get(p.pid);
    const all = offers.get(p.pid);
    let best = null;
    for (const o of all) {
      if (o.amount < ask) continue;
      const roster = rosters.get(o.tid);
      if (roster.length >= RULES.rosterMax) continue;
      if (p.legendary && roster.filter((x) => x.legendary).length >= RULES.maxLegendariesPerTeam) continue;
      if (!canAfford(state, o.tid, o.amount)) continue;
      const { score } = offerScore(state, p, o, roster);
      if (!best || score > best.score || (score === best.score && o.amount > best.o.amount)) best = { o, score };
    }
    if (!best) continue;
    const { o } = best;
    const roster = rosters.get(o.tid);
    sign(state, p, o.amount, o.years);
    Object.assign(p, { tid: o.tid, pos: o.pos, jersey: jerseyFor(roster), faSince: null });
    roster.push(p);
    const yours = all.find((x) => x.yours);
    signed.push({
      pid: p.pid,
      tid: o.tid,
      amount: o.amount,
      years: o.years,
      bids: all.length,
      ...(yours ? { yours: yours.amount } : {}),
    });
  }

  const gone = new Set(signed.map((s) => s.pid));
  fa.offers = fa.offers.filter((o) => !gone.has(o.pid));
  fa.signed += signed.length;
  fa.last = { round: fa.round, signed };
  for (const s of signed.filter((x) => x.yours != null)) {
    const p = state.players[s.pid];
    const t = state.teams[s.tid];
    state.news.unshift({
      season: state.season,
      pid: p.pid,
      text:
        s.tid === state.userTid
          ? `You signed ${p.name} for ${money(s.amount)} a season through ${p.contract.exp}, ahead of ${s.bids - 1} other ${s.bids === 2 ? "offer" : "offers"}.`
          : `${p.name} signed with the ${t.city} ${t.name} for ${money(s.amount)} a season. You offered ${money(s.yours)}.`,
    });
  }
  if (signed.length) {
    const top = signed[0];
    const p = state.players[top.pid];
    state.news.unshift({
      season: state.season,
      pid: p.pid,
      text: `Free agency, round ${fa.round}: ${signed.length} ${signed.length === 1 ? "player" : "players"} signed, led by ${p.name} (${state.teams[top.tid].abbr}, ${money(top.amount)}).`,
    });
  }
  fa.round++;
  if (fa.round > FA.rounds) fa.over = true;
  return signed;
};

export const playAllRounds = (state) => {
  while (state.fa && !state.fa.over) playRound(state);
};
