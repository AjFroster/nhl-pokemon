// Injuries. Players get hurt in games, from hits they take and from time on
// the ice, and miss days while they heal. Sturdy players (Endurance and
// Strength) get hurt less, and players past 30 get hurt more and heal slower.
// An injured player can't dress. A player out for a week or more can go on
// injured reserve, which frees his roster spot (his salary still counts).
// CPU teams sign or call up cover when they run short, and the summer heals
// all but the worst injuries.

import { RULES } from "./ratings.js";
import { autoLines, teamOvr, FREE_AGENT } from "./league.js";
import { fillLines } from "./season.js";
import { needs, faAsk, jerseyFor, justLeft } from "./freeagency.js";
import { signFor } from "./aging.js";
import { playerValue, releaseContract, sign, irRelief, coverRoom, overCap } from "./contracts.js";

export const INJURY = {
  // The chance a hit hurts the player hit, and the chance per 10 seconds on
  // the ice of getting hurt some other way, for a player of average build.
  perHit: 0.006,
  perTick: 0.000022,
  // Goalies take no hits; this is their chance per game played.
  goaliePerGame: 0.007,
  // Past 30, each year adds this much to the chance and to the time out.
  perYearPast30: 0.04,
  // Out at least this many days to go on injured reserve.
  irDays: 7,
  // The summer heals this many days.
  summerDays: 120,
  // Long injuries make the news across the league.
  newsDays: 30,
};

// What can go wrong, how often, and the days out (before age).
export const INJURIES = [
  { name: "Bruised knee", weight: 18, days: [1, 4] },
  { name: "Upper-body injury", weight: 16, days: [2, 8] },
  { name: "Lower-body injury", weight: 16, days: [2, 8] },
  { name: "Sprained ankle", weight: 10, days: [6, 16] },
  { name: "Groin strain", weight: 10, days: [5, 15] },
  { name: "Concussion", weight: 7, days: [7, 30] },
  { name: "Separated shoulder", weight: 5, days: [14, 40] },
  { name: "Broken hand", weight: 5, days: [20, 40] },
  { name: "Knee sprain", weight: 5, days: [20, 45] },
  { name: "Broken leg", weight: 2, days: [50, 90] },
  { name: "Torn ACL", weight: 1.5, days: [120, 200] },
];

// How many players a team dresses for a game: 12 forwards, 6 defensemen, 2 goalies.
export const DRESSED = Object.values(RULES.dressed).reduce((a, b) => a + b, 0);

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const ageFactor = (p) => 1 + INJURY.perYearPast30 * Math.max(0, p.age - 30);

// How easily a player gets hurt, around 1 for an average build.
export const frailty = (p) =>
  clamp(1.3 - (0.6 * ((p.skills.endu + p.skills.stre) / 2 - 20)) / 60, 0.7, 1.3) * ageFactor(p);

// What the injury is and how many days he'll miss.
export const rollInjury = (rng, p) => {
  const kind = INJURIES[rng.weighted(INJURIES.map((x) => x.weight))];
  const days = Math.max(1, Math.round(rng.int(kind.days[0], kind.days[1]) * ageFactor(p)));
  return { name: kind.name, days };
};

export const isHurt = (p) => !!p.injury;
export const onIR = (p) => !!p.injury?.ir;

const teamLabel = (t) => `${t.city} ${t.name}`;
const onTeam = (state, tid) => state.players.filter((p) => p.tid === tid);

// Where a player is in a team's lines, if he is.
const slotOf = (lines, pid) => {
  for (const group of ["F", "D"])
    for (const [i, line] of lines[group].entries()) {
      const j = line.indexOf(pid);
      if (j >= 0) return { group, i, j };
    }
  const i = lines.G.indexOf(pid);
  return i >= 0 ? { group: "G", i } : null;
};
const atSlot = (lines, s) => (s.group === "G" ? lines.G[s.i] : lines[s.group][s.i][s.j]);
const setSlot = (lines, s, pid) => {
  if (s.group === "G") lines.G[s.i] = pid;
  else lines[s.group][s.i][s.j] = pid;
};

// The days left, in words.
export const outFor = (p) => {
  const n = p.injury?.left ?? 0;
  return n === 1 ? "1 more day" : `${n} more days`;
};

// When he should be back, in words.
export const backWhen = (state, p) => {
  const left = p.injury.left;
  if (state.phase === "regular") {
    const day = state.day + left + 1;
    if (day <= state.schedule.length) return `back around day ${day}`;
    return "out for the rest of the regular season";
  }
  if (state.phase === "playoffs") return left > 28 ? "out for the playoffs" : `out ${left} more playoff days`;
  return left > INJURY.summerDays ? "still out when next season starts" : "healed by next season";
};

// A player gets hurt. His team drops him from the lines: you get your best
// healthy player in his spot, and he goes back to it when he heals if that
// player is still there. A CPU team re-sorts its lines and signs cover if it's short.
export const injure = (state, pid, { name, days }, { gid = null } = {}) => {
  const p = state.players[pid];
  if (p.injury) return;
  // Hurt in a game, he starts missing days tomorrow; hurt before a day's
  // games, he misses that day too.
  p.injury = { name, days, left: days, fresh: gid != null, season: state.season, gid };
  const tid = p.tid;
  if (tid < 0) return;
  const t = state.teams[tid];
  if (tid === state.userTid) {
    const slot = slotOf(t.lines, pid);
    fillLines(state, tid);
    let text = `${p.name} is out ${days === 1 ? "a day" : `about ${days} days`} with a ${name.toLowerCase()}.`;
    if (slot) {
      const sub = atSlot(t.lines, slot);
      Object.assign(p.injury, { slot: { ...slot, tid }, sub });
      text +=
        sub == null
          ? " Nobody healthy is left to take his spot, so your lines have a hole."
          : ` ${state.players[sub].name} takes his spot.`;
    }
    state.news.unshift({ season: state.season, pid, text });
  } else {
    if (days >= INJURY.newsDays)
      state.news.unshift({
        season: state.season,
        pid,
        text: `The ${teamLabel(t)} lost ${p.name} for about ${days} days with a ${name.toLowerCase()}.`,
      });
    cpuCover(state, tid);
  }
};

// The best healthy free agent at a position whose ask fits under the cap
// plus a team's injured-reserve relief, signed as injury cover.
export const signCover = (state, tid, roster, pos) => {
  if (!irRelief(state, tid)) return null;
  const room = coverRoom(state, tid);
  const legends = roster.filter((p) => p.legendary).length;
  let best = null;
  let bestAsk = 0;
  for (const p of state.players) {
    if (p.tid !== FREE_AGENT || p.injury || justLeft(state, p, tid)) continue;
    if (p.legendary && legends >= RULES.maxLegendariesPerTeam) continue;
    if (best && (p.ovrs[pos] < best.ovrs[pos] || (p.ovrs[pos] === best.ovrs[pos] && p.pid > best.pid))) continue;
    const ask = faAsk(state, p);
    if (ask > room) continue;
    [best, bestAsk] = [p, ask];
  }
  if (!best) return null;
  sign(state, best, bestAsk, 1, { cover: true });
  Object.assign(best, { tid, pos, jersey: jerseyFor(roster), faSince: null });
  roster.push(best);
  return best;
};

const longestOut = (roster) =>
  roster
    .filter((p) => p.injury && !p.injury.ir && p.injury.left >= INJURY.irDays)
    .sort((a, b) => b.injury.left - a.injury.left || a.pid - b.pid)[0];

// A CPU team short of healthy players (or of two healthy goalies) signs a
// free agent or calls up a prospect. If its roster is full or the cap is in
// the way, it puts its longest-injured player on injured reserve first and
// signs injury cover with the relief. Then it sorts its lines.
export const cpuCover = (state, tid) => {
  const t = state.teams[tid];
  const roster = onTeam(state, tid);
  const active = () => roster.filter((p) => !onIR(p)).length;
  for (let tries = 0; tries < 6; tries++) {
    const fit = roster.filter((p) => !p.injury);
    const goalies = fit.filter((p) => p.pos === "G").length;
    if (fit.length >= DRESSED && goalies >= 2) break;
    const pos = goalies < 2 ? "G" : needs(fit)[0].pos;
    let added = active() < RULES.rosterMax ? signFor(state, tid, roster, true, pos) : null;
    if (!added) {
      const out = longestOut(roster);
      if (out) out.injury.ir = true;
      if (active() < RULES.rosterMax)
        added = signFor(state, tid, roster, true, pos) ?? signCover(state, tid, roster, pos);
    }
    if (!added) break;
    state.news.unshift({
      season: state.season,
      pid: added.pid,
      text: `The ${teamLabel(t)} added ${added.name} to cover for injuries.`,
    });
  }
  t.lines = autoLines(roster);
  t.ovr = teamOvr(t, state.players);
};

// A CPU team over the roster limit or, in the season, over the cap (its
// injured back from injured reserve) lets its injury cover go, any who are
// hurt first, then its least valuable healthy player if it still has too
// many. Cover deals end with the season anyway, so the summer only trims for
// the roster limit.
const cpuTrim = (state, tid) => {
  const roster = onTeam(state, tid);
  let active = roster.filter((p) => !onIR(p));
  const cheapest = (ps) =>
    ps.sort((a, b) => playerValue(a) - playerValue(b) || a.contract.amount - b.contract.amount || a.pid - b.pid)[0];
  const capped = state.phase !== "done";
  while (active.length > RULES.rosterMax || (capped && overCap(state, tid) > 0)) {
    const healthy = active.filter((p) => !p.injury);
    const cover = active.filter((p) => p.contract?.cover);
    const cut =
      cheapest(cover.filter((p) => p.injury)) ??
      cheapest(cover) ??
      (active.length > RULES.rosterMax ? cheapest(healthy) : null);
    if (!cut) break;
    releaseContract(state, cut, tid);
    Object.assign(cut, { tid: FREE_AGENT, jersey: null, faSince: state.season });
    state.news.unshift({
      season: state.season,
      text: `The ${teamLabel(state.teams[tid])} released ${cut.name} to make room.`,
    });
    active = active.filter((p) => p !== cut);
  }
  const t = state.teams[tid];
  t.lines = autoLines(onTeam(state, tid));
  t.ovr = teamOvr(t, state.players);
};

const heal = (state, p) => {
  const { slot, sub } = p.injury;
  delete p.injury;
  const tid = p.tid;
  if (tid < 0) return;
  const t = state.teams[tid];
  if (tid !== state.userTid) return cpuTrim(state, tid);
  let text = `${p.name} is healthy again.`;
  const back = slot?.tid === tid && atSlot(t.lines, slot) === (sub ?? null);
  if (back) {
    setSlot(t.lines, slot, p.pid);
    text += sub == null ? " He's back in his spot." : ` He's back in his spot and ${state.players[sub].name} sits.`;
  }
  fillLines(state, tid);
  if (!slotOf(t.lines, p.pid)) text += " Put him back in your lines when you're ready.";
  if (onTeam(state, tid).filter((x) => !onIR(x)).length > RULES.rosterMax)
    text += ` He's off injured reserve, so you're over ${RULES.rosterMax} players. Release or trade someone before you play.`;
  state.news.unshift({ season: state.season, pid: p.pid, text });
};

// The end of a day: everyone hurt before today is a day closer to healthy,
// and CPU teams still short of players look for cover.
export const healDay = (state) => {
  const short = new Set();
  for (const p of state.players) {
    if (!p.injury) continue;
    if (p.injury.fresh) {
      p.injury.fresh = false;
      continue;
    }
    if (--p.injury.left <= 0) heal(state, p);
    else if (p.tid >= 0 && p.tid !== state.userTid) short.add(p.tid);
  }
  for (const tid of short) {
    const fit = onTeam(state, tid).filter((p) => !p.injury);
    if (fit.length < DRESSED || fit.filter((p) => p.pos === "G").length < 2) cpuCover(state, tid);
  }
};

// The summer heals most injuries. Injured reserve ends with the season, so a
// CPU team over the limit lets someone go, a player whose contract is up first.
export const summerHeal = (state) => {
  for (const p of state.players) {
    if (!p.injury) continue;
    if (p.injury.left <= INJURY.summerDays) heal(state, p);
    else {
      p.injury.left -= INJURY.summerDays;
      p.injury.fresh = false;
      delete p.injury.ir;
      delete p.injury.slot;
      delete p.injury.sub;
    }
  }
  for (const t of state.teams) if (t.tid !== state.userTid) cpuTrim(state, t.tid);
};

// You put a player on injured reserve, freeing his roster spot.
export const placeOnIR = (state, pid) => {
  const p = state.players[pid];
  if (p.tid !== state.userTid) return { ok: false, why: `${p.name} isn't on your team.` };
  if (state.phase === "done") return { ok: false, why: "Injured reserve is only for the season and playoffs." };
  if (!p.injury) return { ok: false, why: `${p.name} isn't hurt.` };
  if (p.injury.ir) return { ok: false, why: `${p.name} is already on injured reserve.` };
  if (p.injury.left < INJURY.irDays)
    return { ok: false, why: `Only a player out at least ${INJURY.irDays} more days can go on injured reserve.` };
  p.injury.ir = true;
  state.news.unshift({
    season: state.season,
    pid,
    text: `${p.name} went on injured reserve. He comes off it when he's healthy.`,
  });
  return { ok: true };
};
