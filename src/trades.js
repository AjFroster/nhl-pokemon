// Trades. Teams swap players, prospects on their reserve lists and draft
// picks up to three drafts ahead, from the end of the playoffs until the
// trade deadline, three quarters of the way through the regular season.
//
// CPU teams value what they get and what they give up the same way: a
// player's rating (more his POT if young, his OVR now if the team is
// contending), how much more he's worth than he's paid, and for a pick, the
// prospect it should bring. A team accepts when it comes out ahead by a
// margin. A Pokémon that evolves by trade (Kadabra, Machoke, Haunter and
// others) evolves as he arrives, so the team getting him values him in his
// evolved form, and the team giving him up doesn't.
//
// During the season CPU teams trade with each other: contenders buy from
// teams out of the race with picks and prospects.

import { RULES, POSITIONS, positionRating } from "./ratings.js";
import { speciesById } from "./dex.js";
import { playerSkills, evolutionMethod } from "./individual.js";
import { RESERVE, PROSPECT, autoLines, teamOvr, owner } from "./league.js";
import {
  contractYear,
  capFor,
  payroll,
  minSalary,
  underContract,
  marketValue,
  playerValue,
  money,
} from "./contracts.js";
import { bestOvr, potential, evolve } from "./growth.js";
import { draftStarted, reserveList, ROUNDS, RESERVE_MAX } from "./draft.js";
import { jerseyFor } from "./freeagency.js";
import { hashString } from "./hash.js";

export const TRADE = {
  // Drafts whose picks can be traded: this one (until it starts) and the next two.
  pickSeasons: 3,
  // The deadline, as a share of the regular season's days.
  deadlineShare: 0.75,
  // A rating this low is worth nothing in a trade; above it value grows with
  // the square, so one star is worth more than several depth players.
  floor: 40,
  scale: 10,
  // Each $1M a season a player is worth more than he's paid, for up to three seasons.
  perMillion: 0.8,
  surplusSeasons: 3,
  // A pick is worth the prospect it should bring, less for each draft further off.
  pickDiscount: [0.9, 0.8, 0.7],
  // A CPU team accepts when it gains this share of what it gives, and at least this much.
  margin: 0.05,
  minGain: 1,
  // Contenders weigh OVR now and care less about picks; teams out of the
  // race take older players for less and picks for more.
  contendPct: 0.57,
  rebuildPct: 0.5,
  contendNow: 0.75,
  contendPicks: 0.7,
  rebuildPicks: 1.15,
  rebuildAge: 28,
  rebuildRental: 0.8,
  // CPU-to-CPU trades: every so many days until the deadline, a few tries.
  cpuEvery: 4,
  cpuTries: 5,
  cpuTargets: 3,
  cpuPackage: 4,
  // A target must be at least this much better than the buyer's weakest regular there.
  cpuUpgrade: 3,
  maxPerTeam: 3,
  // Teams out of the race only sell veterans this old, who are fading anyway.
  sellAge: 29,
};

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const hash = (key) => parseInt(hashString(key).slice(0, 8), 16);

// ---- When ----

export const deadlineDay = (state) => Math.floor(state.schedule.length * TRADE.deadlineShare);

export const tradeWindow = (state) => {
  if (state.phase === "regular" && state.day >= deadlineDay(state))
    return { ok: false, why: "The trade deadline has passed. Trading opens again once the Cup is won." };
  if (state.phase === "playoffs") return { ok: false, why: "There are no trades during the playoffs." };
  return { ok: true };
};

// ---- Draft picks ----

// Who owns a pick: the team it came from unless it was traded.
const pickKey = (season, round, orig) => `${season}:${round}:${orig}`;
export const pickOwner = (state, season, round, orig) => state.pickOwners?.[pickKey(season, round, orig)] ?? orig;

// The drafts whose picks can be traded now.
export const pickSeasons = (state) => {
  const first = draftStarted(state) ? state.season + 1 : state.season;
  return Array.from({ length: TRADE.pickSeasons }, (_, i) => first + i);
};

export const teamPicks = (state, tid) => {
  const picks = [];
  for (const season of pickSeasons(state))
    for (let round = 1; round <= ROUNDS; round++)
      for (const t of state.teams)
        if (pickOwner(state, season, round, t.tid) === tid) picks.push({ kind: "pick", season, round, orig: t.tid });
  return picks;
};

// The draft uses each slot's owner. Once a draft starts its trades are settled.
export const settlePicks = (state, season) => {
  for (const key of Object.keys(state.pickOwners ?? {}))
    if (Number(key.split(":")[0]) <= season) delete state.pickOwners[key];
};

// ---- Assets ----

export const assetKey = (a) => (a.kind === "player" ? `p${a.pid}` : `k${a.season}-${a.round}-${a.orig}`);
export const parseAsset = (key) => {
  if (key[0] === "p") return { kind: "player", pid: Number(key.slice(1)) };
  const [season, round, orig] = key.slice(1).split("-").map(Number);
  return { kind: "pick", season, round, orig };
};

// A player can be traded if he's on a roster or a reserve list, and his
// contract doesn't run out before he'd play for his new team.
const tradeable = (state, p) => {
  if (p.tid === RESERVE) return true;
  if (p.tid < 0) return false;
  return !!p.contract && p.contract.exp >= contractYear(state);
};

export const teamAssets = (state, tid) => [
  ...state.players
    .filter((p) => (p.tid === tid || (p.tid === RESERVE && p.rights === tid)) && tradeable(state, p))
    .map((p) => ({ kind: "player", pid: p.pid })),
  ...teamPicks(state, tid),
];

export const pickLabel = (state, a) => `${state.teams[a.orig].abbr}'s ${a.season} round ${a.round} pick`;
export const assetLabel = (state, a) => (a.kind === "player" ? state.players[a.pid].name : pickLabel(state, a));

// ---- Trade evolutions ----

// The species a player would evolve into by being traded. Karrablast and
// Shelmet need to be traded for each other.
export const tradeEvolutions = (p, partners = []) =>
  (speciesById[p.species].evos ?? []).filter((id) => {
    const to = speciesById[id];
    if (!to || evolutionMethod(to)?.kind !== "trade") return false;
    const needs = /with an? (.+)$/.exec(to.evoCondition ?? "")?.[1];
    return !needs || partners.some((q) => speciesById[q.species].name === needs);
  });

// A player as another species: his ratings recomputed, the rest unchanged.
const asSpecies = (p, id) => {
  const skills = playerSkills(speciesById[id], p);
  return { ...p, species: id, ovrs: Object.fromEntries(POSITIONS.map((pos) => [pos, positionRating(skills, pos)])) };
};

const bestEvolution = (p, options) =>
  options.reduce((a, b) => (bestOvr(asSpecies(p, b).ovrs) > bestOvr(asSpecies(p, a).ovrs) ? b : a));

// ---- What things are worth ----

const pointsPct = (t) => {
  const r = t.record;
  const gp = r.w + r.l + r.otl;
  return gp ? (2 * r.w + r.otl) / (2 * gp) : null;
};

// How a CPU team is thinking: buying, selling or neither. Before twenty
// games it goes by its rating against the rest of the league.
export const strategy = (state, tid) => {
  if (tid === state.userTid) return "neutral";
  const t = state.teams[tid];
  const r = t.record;
  if (r.w + r.l + r.otl >= 20) {
    const pct = pointsPct(t);
    return pct >= TRADE.contendPct ? "contend" : pct < TRADE.rebuildPct ? "rebuild" : "neutral";
  }
  const rank = [...state.teams].sort((a, b) => b.ovr - a.ovr || a.tid - b.tid).findIndex((x) => x.tid === tid);
  return rank < 10 ? "contend" : rank >= state.teams.length - 10 ? "rebuild" : "neutral";
};

const curve = (r) => Math.max(0, r - TRADE.floor) ** 2 / TRADE.scale;

// A prospect who hasn't played yet is drafted on his POT, so he's traded on
// it too, less a little for the years before he plays.
const prospectRating = (p) => 0.3 * playerValue(p) + 0.7 * (0.8 * potential(p) + 0.2 * bestOvr(p.ovrs)) - 2;

// What a player is worth to a team. asId values him as the species he'd
// become on arriving.
export const playerTradeValue = (state, p, tid, { asId = null, strat = strategy(state, tid) } = {}) => {
  const q = asId ? asSpecies(p, asId) : p;
  const prospect = p.tid === RESERVE || p.tid === PROSPECT;
  let r = prospect ? prospectRating(q) : playerValue(q);
  if (strat === "contend" && !prospect) r = TRADE.contendNow * bestOvr(q.ovrs) + (1 - TRADE.contendNow) * r;
  if (strat === "rebuild") r -= Math.max(0, p.age - TRADE.rebuildAge);
  let v = curve(r);
  if (p.contract) {
    const seasons = p.contract.exp - contractYear(state) + 1;
    const surplus = (marketValue(state, q) - p.contract.amount) / 1000;
    v += TRADE.perMillion * surplus * Math.min(seasons, TRADE.surplusSeasons);
    if (strat === "rebuild" && seasons <= 1 && state.phase === "regular") v *= TRADE.rebuildRental;
  }
  return v;
};

// Where a team should pick in a round: worst record first, or worst rating
// before the standings mean much. Picks further off drift toward the middle.
const projectedSlot = (state, season, orig) => {
  const gp = (t) => t.record.w + t.record.l + t.record.otl;
  const byRecord = state.teams.every((t) => gp(t) >= 10);
  const order = [...state.teams].sort((a, b) =>
    byRecord ? pointsPct(a) - pointsPct(b) || a.tid - b.tid : a.ovr - b.ovr || a.tid - b.tid,
  );
  const slot = order.findIndex((t) => t.tid === orig) + 1;
  const middle = (state.teams.length + 1) / 2;
  const drift = Math.min(1, (season - state.season) * 0.5);
  return Math.round(slot + (middle - slot) * drift);
};

// The prospect each overall pick should bring, from this year's class (or
// last year's, once it's drafted).
let classCache = { key: null, values: null };
const classRatings = (state) => {
  const key = `${state.seed}:${state.season}:${state.phase}:${state.players.length}:${state.draft?.next ?? -1}`;
  if (classCache.key === key) return classCache.values;
  let pool = state.players.filter((p) => p.tid === PROSPECT);
  if (pool.length < 100) pool = state.players.filter((p) => p.draft?.season === state.season && p.draft.round);
  const values = pool.map(prospectRating).sort((a, b) => b - a);
  classCache = { key, values };
  return values;
};

export const pickTradeValue = (state, a, tid, { strat = strategy(state, tid) } = {}) => {
  const values = classRatings(state);
  const overall = (a.round - 1) * state.teams.length + projectedSlot(state, a.season, a.orig);
  const r = values[Math.min(values.length - 1, overall - 1)] ?? TRADE.floor;
  const out = clamp(a.season - state.season, 0, TRADE.pickDiscount.length - 1);
  const mult = strat === "contend" ? TRADE.contendPicks : strat === "rebuild" ? TRADE.rebuildPicks : 1;
  return curve(r) * TRADE.pickDiscount[out] * mult;
};

// What one side of a trade is worth to a team, as it gets it (evolved, if
// the trade evolves him) or as it gives it up.
const sideValue = (state, assets, tid, { getting, partners = [], strat }) =>
  assets.reduce((sum, a) => {
    if (a.kind === "pick") return sum + pickTradeValue(state, a, tid, { strat });
    const p = state.players[a.pid];
    const evo = getting ? tradeEvolutions(p, partners) : [];
    return sum + playerTradeValue(state, p, tid, { asId: evo.length ? bestEvolution(p, evo) : null, strat });
  }, 0);

const playersOf = (state, assets) => assets.filter((a) => a.kind === "player").map((a) => state.players[a.pid]);

// A trade from one team's side: what it gets, what it gives and the difference.
export const tradeValue = (state, tid, gets, gives, { strat = strategy(state, tid) } = {}) => {
  const got = sideValue(state, gets, tid, { getting: true, partners: playersOf(state, gives), strat });
  const gave = sideValue(state, gives, tid, { getting: false, strat });
  return { got, gave, gain: got - gave };
};

const accepts = ({ got, gave }) => got - gave >= Math.max(TRADE.minGain, TRADE.margin * gave);

// ---- Rules ----

// What's wrong with a trade, or null. a gives aGives to b, b gives bGives to a.
export const tradeProblem = (state, { a, b, aGives, bGives }) => {
  const w = tradeWindow(state);
  if (!w.ok) return w.why;
  if (a === b || a < 0 || b < 0) return "A trade needs two teams.";
  if (!aGives.length && !bGives.length) return "Add something to the trade.";
  const keys = new Set();
  for (const [side, from] of [
    [aGives, a],
    [bGives, b],
  ]) {
    for (const x of side) {
      if (keys.has(assetKey(x))) return "Something is in the trade twice.";
      keys.add(assetKey(x));
      if (x.kind === "pick") {
        if (!pickSeasons(state).includes(x.season) || x.round < 1 || x.round > ROUNDS)
          return "That pick can't be traded.";
        if (pickOwner(state, x.season, x.round, x.orig) !== from)
          return `${pickLabel(state, x)} isn't theirs to trade.`;
      } else {
        const p = state.players[x.pid];
        if (!p || owner(p) !== from) return `${p?.name ?? "That player"} isn't theirs to trade.`;
        if (!tradeable(state, p)) return `${p.name}'s contract is up, so he can't be traded.`;
      }
    }
  }
  const season = contractYear(state);
  for (const [tid, out, inc] of [
    [a, aGives, bGives],
    [b, bGives, aGives],
  ]) {
    const t = state.teams[tid];
    const gone = new Set(playersOf(state, out).map((p) => p.pid));
    const coming = playersOf(state, inc);
    const roster = state.players.filter((p) => p.tid === tid && !gone.has(p.pid));
    const after = [...roster, ...coming.filter((p) => p.tid >= 0)];
    if (after.length > RULES.rosterMax)
      return `The ${t.name} would have ${after.length} players, over the limit of ${RULES.rosterMax}.`;
    if (state.phase === "regular" && after.length < RULES.minRoster)
      return `The ${t.name} would have ${after.length} players, under the ${RULES.minRoster} they need.`;
    if (after.filter((p) => p.legendary).length > RULES.maxLegendariesPerTeam)
      return `The ${t.name} would have two Legendaries. Teams may carry ${RULES.maxLegendariesPerTeam}.`;
    const reserve =
      reserveList(state, tid).filter((p) => !gone.has(p.pid)).length + coming.filter((p) => p.tid === RESERVE).length;
    if (reserve > RESERVE_MAX) return `The ${t.name} reserve list would hold ${reserve}, over ${RESERVE_MAX}.`;
    const salary = (ps) => ps.reduce((s, p) => s + (p.tid >= 0 && p.contract ? p.contract.amount : 0), 0);
    const before = payroll(state, tid, season);
    const pay = before - salary(playersOf(state, out)) + salary(coming);
    const signed =
      underContract(state, tid, season).filter((p) => !gone.has(p.pid)).length +
      coming.filter((p) => p.tid >= 0).length;
    const short = Math.max(0, RULES.minRoster - signed);
    if (pay > before && pay + short * minSalary(state, season) > capFor(state, season))
      return `The ${t.name} can't fit ${money(pay - before)} more under the cap${short ? ` and still fill their roster` : ""}.`;
  }
  return null;
};

// ---- Making a trade ----

const describe = (state, assets) => {
  const names = assets.map((x) => assetLabel(state, x));
  return names.length ? names.join(", ") : "nothing";
};

// Moves everything and evolves whoever evolves by trade. Returns the
// players who evolved, as [player, from].
export const executeTrade = (state, trade) => {
  const { a, b, aGives, bGives } = trade;
  // How even it was, judged by a team with no plans either way, for the
  // season simulations.
  const even = (side) => sideValue(state, side, a, { getting: false, strat: "neutral" });
  const values = [even(aGives), even(bGives)].map((v) => Math.round(v * 10) / 10);
  const moved = [];
  for (const [side, to, partners] of [
    [aGives, b, playersOf(state, bGives)],
    [bGives, a, playersOf(state, aGives)],
  ]) {
    for (const x of side) {
      if (x.kind === "pick") {
        state.pickOwners ??= {};
        const key = pickKey(x.season, x.round, x.orig);
        if (to === x.orig) delete state.pickOwners[key];
        else state.pickOwners[key] = to;
        continue;
      }
      const p = state.players[x.pid];
      if (p.tid === RESERVE) p.rights = to;
      else {
        p.tid = to;
        p.jersey = jerseyFor(state.players.filter((q) => q.tid === to && q !== p));
      }
      moved.push([p, partners]);
    }
  }
  // Everyone's options first, so Karrablast still sees a Shelmet.
  const evolved = [];
  for (const [p, options] of moved.map(([p, partners]) => [p, tradeEvolutions(p, partners)])) {
    if (!options.length) continue;
    if (owner(p) === state.userTid && options.length > 1) {
      p.evolveChoices = [...new Set([...(p.evolveChoices ?? []), ...options])];
      continue;
    }
    const from = p.name;
    evolve(state, p, bestEvolution(p, options));
    evolved.push([p, from]);
  }
  for (const tid of [a, b]) {
    const t = state.teams[tid];
    const roster = state.players.filter((p) => p.tid === tid);
    if (tid === state.userTid) {
      const on = new Set(roster.map((p) => p.pid));
      const L = t.lines;
      const keep = (pid) => (pid != null && on.has(pid) ? pid : null);
      L.F = L.F.map((l) => l.map(keep));
      L.D = L.D.map((l) => l.map(keep));
      L.G = L.G.map(keep);
      const used = new Set([...L.F.flat(), ...L.D.flat(), ...L.G].filter((x) => x != null));
      const best = (pos) => {
        const p = roster.filter((x) => !used.has(x.pid)).sort((x, y) => y.ovrs[pos] - x.ovrs[pos])[0];
        if (p) used.add(p.pid);
        return p?.pid ?? null;
      };
      L.G = L.G.map((pid) => pid ?? best("G"));
      L.D = L.D.map((pair) => pair.map((pid) => pid ?? best("D")));
      L.F = L.F.map((l) => l.map((pid, i) => pid ?? best(i === 0 ? "C" : "W")));
    } else t.lines = autoLines(roster);
    t.ovr = teamOvr(t, state.players);
  }
  const [ta, tb] = [state.teams[a], state.teams[b]];
  (state.trades ??= []).push({
    season: state.season,
    day: state.phase === "regular" ? state.day : null,
    a,
    b,
    aGives: aGives.map(assetKey),
    bGives: bGives.map(assetKey),
    values,
  });
  state.news.unshift({
    season: state.season,
    text: `Trade: the ${ta.city} ${ta.name} sent ${describe(state, aGives)} to the ${tb.city} ${tb.name} for ${describe(state, bGives)}.`,
  });
  for (const [p, from] of evolved)
    state.news.unshift({
      season: state.season,
      pid: p.pid,
      text: `${from} “${p.nickname}” evolved into ${p.name} on the trade to the ${state.teams[owner(p)].city} ${state.teams[owner(p)].name}!`,
    });
  for (const p of playersOf(state, [...aGives, ...bGives]))
    if (p.evolveChoices && owner(p) === state.userTid)
      state.news.unshift({
        season: state.season,
        pid: p.pid,
        text: `${p.name} “${p.nickname}” can evolve now that he's been traded. Pick what into on his card.`,
      });
  return evolved;
};

// ---- You and a CPU team ----

// What the other team makes of your offer: you give mine, they give theirs.
export const judgeTrade = (state, tid, mine, theirs) => {
  const trade = { a: state.userTid, b: tid, aGives: mine, bGives: theirs };
  const why = tradeProblem(state, trade);
  if (why) return { ok: false, why };
  const v = tradeValue(state, tid, mine, theirs);
  const need = Math.max(TRADE.minGain, TRADE.margin * v.gave);
  // How far apart, for the screen: 1 is just enough, 0 is giving it away.
  const fair = v.gave + need > 0 ? clamp(v.got / (v.gave + need), 0, 2) : 2;
  return { ok: true, accepts: accepts(v), fair, ...v };
};

export const proposeTrade = (state, tid, mine, theirs) => {
  const j = judgeTrade(state, tid, mine, theirs);
  if (!j.ok) return j;
  const t = state.teams[tid];
  if (!j.accepts)
    return {
      ...j,
      ok: false,
      why:
        j.fair < 0.5
          ? `The ${t.name} turned it down flat. They'd want a lot more.`
          : `The ${t.name} said no, but they're interested. They'd want a little more.`,
    };
  const evolved = executeTrade(state, { a: state.userTid, b: tid, aGives: mine, bGives: theirs });
  return { ...j, ok: true, evolved };
};

// The smallest thing you could add to get the other team to yes: whatever of
// yours they'd take that closes the gap and costs you least. Up to three
// additions. Returns your side of the trade, or null if nothing works.
export const balanceTrade = (state, tid, mine, theirs) => {
  let side = [...mine];
  for (let i = 0; i < 3; i++) {
    const j = judgeTrade(state, tid, side, theirs);
    if (j.ok && j.accepts) return side;
    // Adding something can also fix a problem, such as salary that doesn't fit.
    const have = new Set(side.map(assetKey));
    const options = teamAssets(state, state.userTid)
      .filter((x) => !have.has(assetKey(x)))
      .map((x) => {
        const next = [...side, x];
        const k = judgeTrade(state, tid, next, theirs);
        const cost = sideValue(state, [x], state.userTid, { getting: false, strat: "neutral" });
        return k.ok && (!j.ok || k.got > j.got) ? { next, k, cost } : null;
      })
      .filter(Boolean);
    if (!options.length) return null;
    const enough = options.filter((o) => o.k.accepts).sort((p, q) => p.cost - q.cost);
    if (enough.length) return enough[0].next;
    side = options.sort((p, q) => q.k.got - q.k.gave - (p.k.got - p.k.gave) || p.cost - q.cost)[0].next;
  }
  const last = judgeTrade(state, tid, side, theirs);
  return last.ok && last.accepts ? side : null;
};

// ---- CPU teams with each other ----

const tradesThisSeason = (state, tid) =>
  (state.trades ?? []).filter((t) => t.season === state.season && (t.a === tid || t.b === tid)).length;

// A contender looks at a seller's roster for an upgrade over its weakest
// regular at that position, one it values more than the seller does (an
// older player, or one about to leave), and offers the things the seller likes more than
// it does: picks, prospects and young players, cheapest to it first.
const tryCpuTrade = (state, buyer, seller, salt) => {
  const group = (pos) => (pos === "G" ? "G" : pos === "D" ? "D" : "F");
  const regulars = { F: 12, D: 6, G: 1 };
  const mine = state.players.filter((p) => p.tid === buyer);
  const weakest = {};
  for (const g of ["F", "D", "G"]) {
    const xs = mine
      .filter((p) => group(p.pos) === g)
      .map((p) => p.ovrs[p.pos])
      .sort((x, y) => y - x);
    weakest[g] = xs[Math.min(xs.length, regulars[g]) - 1] ?? 0;
  }
  const targets = state.players
    .filter(
      (p) =>
        p.tid === seller &&
        p.age >= TRADE.sellAge &&
        tradeable(state, p) &&
        p.ovrs[p.pos] >= weakest[group(p.pos)] + TRADE.cpuUpgrade,
    )
    .map((p) => ({ p, v: playerTradeValue(state, p, buyer) - playerTradeValue(state, p, seller) }))
    .filter((x) => x.v > 0)
    .sort((x, y) => y.v - x.v || x.p.pid - y.p.pid)
    .slice(0, TRADE.cpuTargets);
  if (!targets.length) return null;
  const { p: target } = targets[hash(`${salt}:target`) % targets.length];
  const want = [{ kind: "player", pid: target.pid }];
  const pieces = teamAssets(state, buyer)
    .filter((x) => x.kind === "pick" || state.players[x.pid].tid === RESERVE || state.players[x.pid].age <= 24)
    .map((x) => ({
      x,
      them: sideValue(state, [x], seller, { getting: true }),
      us: sideValue(state, [x], buyer, { getting: false }),
    }))
    .filter((o) => o.them > 0.5)
    .sort(
      (o, q) => q.them / Math.max(1, q.us) - o.them / Math.max(1, o.us) || assetKey(o.x).localeCompare(assetKey(q.x)),
    );
  const pkg = [];
  for (const o of pieces) {
    if (pkg.length >= TRADE.cpuPackage) break;
    pkg.push(o.x);
    if (accepts(tradeValue(state, seller, pkg, want))) break;
  }
  if (!accepts(tradeValue(state, seller, pkg, want))) return null;
  if (!accepts(tradeValue(state, buyer, want, pkg))) return null;
  // A full roster sends its weakest regular back the other way.
  const trade = { a: buyer, b: seller, aGives: pkg, bGives: want };
  if (tradeProblem(state, trade)) {
    const spare = mine
      .filter((p) => tradeable(state, p) && !pkg.some((x) => x.pid === p.pid))
      .sort((x, y) => playerTradeValue(state, x, buyer) - playerTradeValue(state, y, buyer) || x.pid - y.pid)[0];
    if (!spare) return null;
    trade.aGives = [...pkg, { kind: "player", pid: spare.pid }];
    if (tradeProblem(state, trade)) return null;
    if (
      !accepts(tradeValue(state, seller, trade.aGives, want)) ||
      !accepts(tradeValue(state, buyer, want, trade.aGives))
    )
      return null;
  }
  executeTrade(state, trade);
  return trade;
};

// Run on each day of the regular season. Every few days until the deadline,
// a few contenders call teams out of the race.
export const cpuTradeDay = (state) => {
  if (state.phase !== "regular" || state.day >= deadlineDay(state) || state.day % TRADE.cpuEvery) return [];
  const done = [];
  const cpu = state.teams.filter((t) => t.tid !== state.userTid && tradesThisSeason(state, t.tid) < TRADE.maxPerTeam);
  const buyers = cpu.filter((t) => strategy(state, t.tid) === "contend");
  // A team out of the race sells once a season, so it isn't stripped bare.
  const sellers = cpu.filter((t) => strategy(state, t.tid) === "rebuild" && !tradesThisSeason(state, t.tid));
  if (!buyers.length || !sellers.length) return done;
  const used = new Set();
  for (let i = 0; i < TRADE.cpuTries; i++) {
    const salt = `${state.seed}:${state.season}:${state.day}:trade${i}`;
    const buyer = buyers[hash(`${salt}:buyer`) % buyers.length];
    const seller = sellers[hash(`${salt}:seller`) % sellers.length];
    if (used.has(buyer.tid) || used.has(seller.tid)) continue;
    const trade = tryCpuTrade(state, buyer.tid, seller.tid, salt);
    if (trade) {
      done.push(trade);
      used.add(buyer.tid);
      used.add(seller.tid);
    }
  }
  return done;
};

// For the season simulations: how even a trade was, judged by a neutral
// team, from 0 (even) to 1 (one side got nothing).
export const tradeImbalance = ({ values: [va, vb] }) =>
  Math.min(1, Math.abs(va - vb) / Math.max(1, Math.abs(va), Math.abs(vb)));
