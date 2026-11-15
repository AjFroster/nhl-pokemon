// Mood and negotiation. Every player has one or two traits, and a mood about
// his team that comes from four things: whether the team wins, how much he
// plays, whether his contract pays what he's worth, and how long he's been
// there. A trait doubles the thing he cares about most. When his contract is
// up, a happy player re-signs near his value (or a little under), an unhappy
// one asks up to 50% more, and one who is fed up won't talk at all.
//
// Nothing here is stored: traits come from the league's seed and the player's
// id, and mood from the season so far, so old saves get both for free.

import { hashString } from "./hash.js";
import { marketValue } from "./contracts.js";

export const TRAITS = {
  loyal: {
    name: "Loyal",
    cares: "tenure",
    text: "Years with the team count double, and he'll always talk.",
    market: "Getting the years he wants counts double.",
  },
  payday: {
    name: "Pay Day",
    cares: "pay",
    text: "His pay counts double, and he never gives a discount.",
    market: "Money counts double.",
  },
  competitive: {
    name: "Competitive",
    cares: "winning",
    text: "Winning and losing count double.",
    market: "A winning team counts double.",
  },
  spotlight: {
    name: "Spotlight",
    cares: "role",
    text: "Ice time counts double.",
    market: "A bigger role counts double.",
  },
};
const TRAIT_KEYS = Object.keys(TRAITS);
const SECOND_TRAIT_CHANCE = 35;

// One trait for everyone, and a second for about a third of players. A
// player given traits of his own keeps them.
export const traitsOf = (state, p) => {
  if (p.traits) return p.traits;
  const h = parseInt(hashString(`${state.seed}:${p.pid}:traits`).slice(0, 8), 16);
  const first = h % 4;
  const traits = [TRAIT_KEYS[first]];
  if ((h >>> 8) % 100 < SECOND_TRAIT_CHANCE) traits.push(TRAIT_KEYS[(first + 1 + ((h >>> 16) % 3)) % 4]);
  return traits;
};

export const MOOD = {
  // Nothing counts until the team has played this many games.
  minGames: 10,
  // Winning: a team's share of the points on offer, around the league's usual .560.
  parPct: 0.56,
  pctPerPoint: 0.07,
  cup: 1,
  // Ice time: skaters by rank in minutes a game among the team's forwards or
  // defensemen, goalies by their share of the starts.
  topForwards: 6,
  midForwards: 9,
  topDefense: 2,
  midDefense: 4,
  starterShare: 0.5,
  backupShare: 0.15,
  dressedShare: 0.5,
  // Pay: his salary against what he'd ask today. Rookie deals don't count.
  underpaid: 0.75,
  overpaid: 1.25,
  // Tenure: each season after his first, up to five.
  perSeason: 0.3,
  maxTenure: 1.5,
  // Negotiation.
  markupAtZero: 0.05,
  markupPerPoint: 0.1,
  maxMarkup: 0.5,
  discount: 0.05,
  loyalDiscount: 0.1,
  refuseAt: -4,
};

export const LEVELS = [
  { key: "happy", name: "Happy", from: 1.5 },
  { key: "content", name: "Content", from: 0 },
  { key: "restless", name: "Restless", from: -2 },
  { key: "unhappy", name: "Unhappy", from: MOOD.refuseAt },
  { key: "fedup", name: "Fed up", from: -Infinity },
];

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// His line for this season: the one in progress, or, in the summer after the
// stats are filed, the one just added to his career.
const seasonLine = (state, p) => {
  if (p.stats?.gp) return p.stats;
  const last = p.career?.at(-1);
  return last && last.season === state.season && last.tid === p.tid ? last.stats : null;
};

// What every player on a team needs to know about it: its record, and where
// each teammate ranks in ice time.
const teamContext = (state, tid) => {
  const t = state.teams[tid];
  const r = t.record;
  const gp = r.w + r.l + r.otl;
  const role = new Map();
  if (gp >= MOOD.minGames) {
    const lines = state.players.filter((p) => p.tid === tid).map((p) => [p, seasonLine(state, p)]);
    const minutes = ([, s]) => (s.toi ?? 0) / s.gp;
    for (const group of ["F", "D"]) {
      const regulars = lines
        .filter(([p, s]) => p.pos !== "G" && (p.pos === "D") === (group === "D") && s && s.gp / gp >= MOOD.dressedShare)
        .sort((a, b) => minutes(b) - minutes(a) || a[0].pid - b[0].pid);
      const [top, mid] = group === "F" ? [MOOD.topForwards, MOOD.midForwards] : [MOOD.topDefense, MOOD.midDefense];
      regulars.forEach(([p], i) =>
        role.set(
          p.pid,
          i < top
            ? [1, group === "F" ? "Plays top-six minutes" : "Plays top-pair minutes"]
            : i < mid
              ? [0, group === "F" ? "Plays third-line minutes" : "Plays second-pair minutes"]
              : [-0.5, group === "F" ? "Plays fourth-line minutes" : "Plays third-pair minutes"],
        ),
      );
    }
    for (const [p, s] of lines) {
      if (role.has(p.pid)) continue;
      if (p.pos !== "G") role.set(p.pid, [-1.5, "Rarely dresses"]);
      else {
        const share = (s?.gs ?? 0) / gp;
        role.set(
          p.pid,
          share >= MOOD.starterShare
            ? [1, "The starting goalie"]
            : share >= MOOD.backupShare
              ? [0, "The backup goalie"]
              : [-1, "Rarely plays"],
        );
      }
    }
  }
  return { tid, gp, pct: gp ? (2 * r.w + r.otl) / (2 * gp) : 0, champion: state.champion === tid, role };
};

const level = (score) => LEVELS.find((l) => score >= l.from);

// A player's mood about his team, or null if he isn't on one. reasons lists
// what moves it, each with its points after his traits are counted.
export const moodOf = (state, p, ctx = p.tid >= 0 ? teamContext(state, p.tid) : null) => {
  if (!ctx || p.tid !== ctx.tid) return null;
  const traits = traitsOf(state, p);
  const cares = new Set(traits.map((k) => TRAITS[k].cares));
  const reasons = [];
  const add = (key, value, label) => {
    const v = Math.round(value * (cares.has(key) ? 2 : 1) * 10) / 10;
    if (v) reasons.push({ key, value: v, label });
  };

  if (ctx.gp >= MOOD.minGames) {
    const w = clamp((ctx.pct - MOOD.parPct) / MOOD.pctPerPoint, -2, 2);
    add("winning", w, w > 0 ? "The team is winning" : "The team is losing");
    if (ctx.champion) add("cup", MOOD.cup, "Won the Cup");
    const [r, label] = ctx.role.get(p.pid) ?? [0, ""];
    add("role", r, label);
  }
  if (p.contract && !p.contract.rookie && state.market) {
    const ratio = p.contract.amount / marketValue(state, p);
    if (ratio < MOOD.underpaid) add("pay", -1, "Paid less than he's worth");
    else if (ratio > MOOD.overpaid) add("pay", 0.5, "Paid more than he'd ask today");
  }
  const seasons = p.loyalty?.tid === p.tid ? p.loyalty.seasons : 1;
  add("tenure", Math.min(MOOD.maxTenure, MOOD.perSeason * (seasons - 1)), `${seasons} seasons with the team`);

  const score = Math.round(reasons.reduce((s, r) => s + r.value, 0) * 10) / 10;
  const loyal = traits.includes("loyal");
  const refuses = score <= MOOD.refuseAt && !loyal;
  const floor = traits.includes("payday") ? 0 : loyal ? -MOOD.loyalDiscount : -MOOD.discount;
  const markup = Math.round(clamp(MOOD.markupAtZero - MOOD.markupPerPoint * score, floor, MOOD.maxMarkup) * 100) / 100;
  return {
    score,
    // A Loyal player never gets past unhappy.
    level: refuses ? LEVELS[4] : score <= MOOD.refuseAt ? LEVELS[3] : level(score),
    traits,
    reasons: reasons.sort((a, b) => Math.abs(b.value) - Math.abs(a.value)),
    markup,
    refuses,
  };
};

// Everyone on a team at once, by pid.
export const teamMoods = (state, tid) => {
  const ctx = teamContext(state, tid);
  return new Map(state.players.filter((p) => p.tid === tid).map((p) => [p.pid, moodOf(state, p, ctx)]));
};
