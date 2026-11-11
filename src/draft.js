// The draft: every season a class of young Pokémon prospects, an NHL-style
// lottery for the teams that missed the playoffs, and seven rounds. Your
// scouts see each prospect through a fog until they give him a full look.
// Drafted players go on their team's reserve list, outside the 23-man roster,
// until they're called up. Undrafted prospects become free agents.

import { DEX, speciesById } from "./dex.js";
import { makePlayer, dexById, owner, RESERVE, PROSPECT, FREE_AGENT } from "./league.js";
import { isLegendary, POSITIONS, RULES } from "./ratings.js";
import { potential, bestOvr } from "./growth.js";
import { compareTeams, fillLines } from "./season.js";
import { hashString } from "./hash.js";

export const CLASS_SIZE = 260;
export const ROUNDS = 7;
export const RESERVE_MAX = 10;
// Prospects still on a reserve list at this age are released.
export const RESERVE_AGE_LIMIT = 23;
export const SHINY_ODDS = 1 / 200;
// Full looks your scouts can give prospects each season.
export const FULL_SCOUTS = 3;
// How far off an unscouted prospect's OVR and POT can look, either way.
export const FOG = 8;

// ---- The class ----

const finals = (id) => {
  const evos = (speciesById[id].evos ?? []).filter((e) => speciesById[e]);
  return evos.length ? evos.flatMap(finals) : [id];
};
const bst = (s) => Object.values(s.bs).reduce((a, b) => a + b, 0);

// First-stage species that aren't Legendary, weighted so strong lines are
// rare: a line whose best final form has up to 500 base stats counts fully,
// and above that its weight halves for every 29 points, so a line ending at
// 600 is about 11 times rarer. Lines that end in a pseudo-legendary (like
// Dragonite or Garchomp) are rarer again. Weak lines are never favoured, so a
// class isn't full of Wishiwashi.
const PSEUDO_WEIGHT = 0.15;
const COMMON_TOP = 500;
const RARITY = 42;
export const CLASS_SPECIES = DEX.filter((s) => (!s.prevo || !speciesById[s.prevo]) && !isLegendary(s)).map((s) => ({
  s,
  top: Math.max(...finals(s.id).map((id) => bst(speciesById[id]))),
  pseudo: finals(s.id).some((id) => bst(speciesById[id]) >= 600 && !isLegendary(speciesById[id])),
}));
export const classWeight = (x) => (x.pseudo ? PSEUDO_WEIGHT : 1) * Math.exp(-Math.max(0, x.top - COMMON_TOP) / RARITY);
const CLASS_WEIGHTS = CLASS_SPECIES.map(classWeight);

// A new class for this season's draft, 18 and 19 years old.
export const makeClass = (state, rng) => {
  const byId = dexById(DEX);
  const pids = [];
  for (let i = 0; i < CLASS_SIZE; i++) {
    const { s } = CLASS_SPECIES[rng.weighted(CLASS_WEIGHTS)];
    const p = makePlayer(s, state.players.length, rng, byId, rng.int(18, 19));
    p.tid = PROSPECT;
    p.shiny = rng.chance(SHINY_ODDS);
    p.draft = { season: state.season, round: null, pick: null, tid: null };
    state.players.push(p);
    pids.push(p.pid);
  }
  state.scouted = [];
  return pids;
};

export const draftClass = (state) => state.players.filter((p) => p.tid === PROSPECT);

// ---- What your scouts see ----

export const isScouted = (state, p) => owner(p) === state.userTid || (state.scouted ?? []).includes(p.pid);

const fog = (state, p, salt) =>
  isScouted(state, p)
    ? 0
    : (parseInt(hashString(`${state.seed}:${p.pid}:${salt}`).slice(0, 6), 16) % (2 * FOG + 1)) - FOG;

// A prospect's OVR at a position and his POT, as your scouts see them.
export const scoutOvr = (state, p, pos) => Math.max(1, p.ovrs[pos] + fog(state, p, "ovr"));
export const scoutPot = (state, p) => {
  const ovr = Math.max(...POSITIONS.map((pos) => scoutOvr(state, p, pos)));
  return Math.max(ovr, potential(p) + fog(state, p, "pot"));
};

export const scoutsLeft = (state) => FULL_SCOUTS - (state.scouted ?? []).length;

export const scoutProspect = (state, pid) => {
  const p = state.players[pid];
  if (p.tid !== PROSPECT) throw new Error(`${p.name} isn't in the draft class.`);
  if (isScouted(state, p)) return { ok: false, why: `Your scouts already know ${p.name}.` };
  if (scoutsLeft(state) <= 0) return { ok: false, why: "Your scouts have used their full looks this season." };
  state.scouted.push(pid);
  return { ok: true };
};

// ---- The order ----

// NHL lottery odds for the 16 teams that missed the playoffs, worst first.
export const LOTTERY_ODDS = [
  0.185, 0.135, 0.115, 0.095, 0.085, 0.075, 0.065, 0.06, 0.05, 0.035, 0.03, 0.025, 0.02, 0.015, 0.005, 0.005,
];
// A lottery winner moves up at most this many spots.
export const LOTTERY_JUMP = 10;

// Two draws, for the first and second picks. A winner too far back moves up
// ten spots instead, and the teams he passes slide down one.
export const runLottery = (order, rng) => {
  const result = [...order];
  const winners = [];
  for (let draw = 0; draw < 2; draw++) {
    const left = order.filter((tid) => !winners.includes(tid));
    const tid = left[rng.weighted(left.map((t) => LOTTERY_ODDS[order.indexOf(t)]))];
    winners.push(tid);
    const from = result.indexOf(tid);
    const to = Math.max(draw, from - LOTTERY_JUMP);
    if (to < from) {
      result.splice(from, 1);
      result.splice(to, 0, tid);
    }
  }
  return { result, winners };
};

// How far each team got in the playoffs: 0 missed, 1 to 4 lost in that round, 5 won.
const finishes = (state) => {
  const finish = state.teams.map(() => 0);
  state.playoffs.rounds.forEach((round, r) => {
    for (const s of round) for (const tid of [s.home, s.away]) finish[tid] = Math.max(finish[tid], r + 1);
  });
  finish[state.champion] = 5;
  return finish;
};

// Teams that missed the playoffs go first, worst record first, after the
// lottery. Playoff teams follow by how far they got, then by record.
export const draftOrder = (state, rng) => {
  const finish = finishes(state);
  const worstFirst = (a, b) => -compareTeams(a, b);
  const missed = state.teams.filter((t) => finish[t.tid] === 0).sort(worstFirst);
  const made = state.teams
    .filter((t) => finish[t.tid] > 0)
    .sort((a, b) => finish[a.tid] - finish[b.tid] || worstFirst(a, b));
  const lottery = runLottery(
    missed.map((t) => t.tid),
    rng,
  );
  return {
    order: [...lottery.result, ...made.map((t) => t.tid)],
    lottery: { before: missed.map((t) => t.tid), ...lottery },
  };
};

// ---- Picks ----

// The draft runs once the Cup is won, before the next season starts.
export const draftStarted = (state) => state.draft?.season === state.season;
export const draftDone = (state) => draftStarted(state) && state.draft.done;

export const startDraft = (state, rng) => {
  if (state.phase !== "done") throw new Error("The draft comes after the Cup is won.");
  if (draftStarted(state)) return state.draft;
  const { order, lottery } = draftOrder(state, rng);
  const picks = [];
  for (let round = 1; round <= ROUNDS; round++)
    order.forEach((tid, i) => picks.push({ round, pick: i + 1, tid, pid: null }));
  state.draft = { season: state.season, lottery, picks, next: 0, done: false };
  const winner = state.teams[order[0]];
  state.news.unshift({
    season: state.season,
    text: `The ${winner.city} ${winner.name} won the draft lottery and pick first.`,
  });
  return state.draft;
};

export const onTheClock = (state) => state.draft?.picks[state.draft.next] ?? null;

// How much a CPU team likes a prospect: mostly his POT, a little his OVR now,
// each team's scouts off by their own few points.
const cpuValue = (state, p, tid) => {
  const noise = (parseInt(hashString(`${state.seed}:${p.pid}:cpu${tid}`).slice(0, 6), 16) % 9) - 4;
  return 0.8 * potential(p) + 0.2 * bestOvr(p.ovrs) + noise;
};

export const bestAvailable = (state, tid) => {
  let best = null;
  let bestValue = -Infinity;
  for (const p of draftClass(state)) {
    const v = cpuValue(state, p, tid);
    if (v > bestValue || (v === bestValue && p.pid < best.pid)) [best, bestValue] = [p, v];
  }
  return best;
};

export const makePick = (state, pid) => {
  const d = state.draft;
  const slot = d.picks[d.next];
  const p = state.players[pid];
  if (!slot || d.done) throw new Error("The draft is over.");
  if (p.tid !== PROSPECT) throw new Error(`${p.name} isn't available.`);
  slot.pid = pid;
  p.tid = RESERVE;
  p.rights = slot.tid;
  p.pos = p.natural;
  p.draft = { season: d.season, round: slot.round, pick: slot.pick, tid: slot.tid };
  if (slot.tid === state.userTid || slot.round === 1) {
    const t = state.teams[slot.tid];
    state.news.unshift({
      season: state.season,
      pid,
      text: `The ${t.city} ${t.name} drafted ${p.name} “${p.nickname}” with pick ${slot.pick} of round ${slot.round}.`,
    });
  }
  d.next++;
  if (d.next >= d.picks.length) finishDraft(state);
  return slot;
};

// CPU teams pick until it's your turn (or the draft ends). With auto, your
// scouts pick for you too.
export const runDraft = (state, { auto = false } = {}) => {
  while (!state.draft.done) {
    const slot = onTheClock(state);
    if (slot.tid === state.userTid && !auto) return slot;
    makePick(state, bestAvailable(state, slot.tid).pid);
  }
  return null;
};

// Whoever is left becomes a free agent.
const finishDraft = (state) => {
  state.draft.done = true;
  for (const p of draftClass(state)) {
    p.tid = FREE_AGENT;
    p.faSince = state.season;
  }
  state.news.unshift({
    season: state.season,
    text: `The ${state.season} draft is over. The rest of the class are free agents.`,
  });
};

// ---- The reserve list ----

export const reserveList = (state, tid) => state.players.filter((p) => p.tid === RESERVE && p.rights === tid);

export const releaseRights = (state, p) => {
  p.tid = FREE_AGENT;
  p.rights = null;
  p.faSince = state.season;
};

export const callUp = (state, pid, tid) => {
  const p = state.players[pid];
  p.tid = tid;
  p.rights = null;
  p.pos = p.natural;
  const used = new Set(state.players.filter((x) => x.tid === tid).map((x) => x.jersey));
  let n = 2;
  while (used.has(n)) n++;
  p.jersey = n;
};

// You call up one of your prospects: he joins the roster and the lines.
export const callUpPlayer = (state, pid, tid = state.userTid) => {
  const p = state.players[pid];
  if (p.tid !== RESERVE || p.rights !== tid) return { ok: false, why: `${p.name} isn't on your reserve list.` };
  if (state.players.filter((x) => x.tid === tid).length >= RULES.rosterMax)
    return { ok: false, why: `Your roster is full at ${RULES.rosterMax}. Release someone first.` };
  callUp(state, pid, tid);
  fillLines(state, tid);
  const t = state.teams[tid];
  state.news.unshift({ season: state.season, pid, text: `The ${t.city} ${t.name} called up ${p.name}.` });
  return { ok: true };
};

// You give up your rights to a prospect: he becomes a free agent.
export const releaseProspect = (state, pid, tid = state.userTid) => {
  const p = state.players[pid];
  if (p.tid !== RESERVE || p.rights !== tid) return { ok: false, why: `${p.name} isn't on your reserve list.` };
  releaseRights(state, p);
  const t = state.teams[tid];
  state.news.unshift({ season: state.season, text: `The ${t.city} ${t.name} released their rights to ${p.name}.` });
  return { ok: true };
};

// The value CPU teams use to keep or cut a prospect.
export const prospectValue = (state, p) => cpuValue(state, p, owner(p));
