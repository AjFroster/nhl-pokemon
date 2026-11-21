// Between seasons: when the Cup is won, the draft runs (draft.js), the
// season goes into the league's history, every player's stats go into his
// career, breakouts and busts move potential tiers, everyone gets a year
// older, veterans wear down and some retire, contracts run out, free agency
// runs its bidding rounds, teams fill what's left of their rosters, training camp hands out XP and evolutions, a new draft class arrives to
// scout, and a new schedule starts the next season.

import { makeRng } from "./random.js";
import { makeSchedule } from "./schedule.js";
import { points, standings, fillLines } from "./season.js";
import { emptyStats, RETIRED } from "./league.js";
import { summerRetirements, summerRosters, contractSummer } from "./aging.js";
import { openMarket, playRound, playAllRounds } from "./freeagency.js";
import { startDraft, runDraft, draftDone, makeClass } from "./draft.js";
import { seasonOutliers, applyOutliers, trainingCamp } from "./growth.js";

// Kept short so a league that runs for decades still saves quickly.
const NEWS_KEPT = 120;

// A career line keeps only the stats that aren't zero (a skater has no saves, a
// goalie rarely scores), with ice time in whole seconds. Missing stats read as 0.
const compactStats = (s) => {
  const out = {};
  for (const [k, v] of Object.entries(s)) if (v) out[k] = k === "toi" ? Math.round(v) : v;
  return out;
};

const leader = (players, value, filter = () => true) => {
  let best = null;
  for (const p of players) {
    if (!filter(p)) continue;
    const v = value(p.stats);
    if (best == null || v > best[1]) best = [p.pid, v];
  }
  return best;
};

// How far each team got: 0 missed the playoffs, 1 to 4 lost in that round, 5 won the Cup.
const playoffFinish = (state) => {
  const finish = state.teams.map(() => 0);
  state.playoffs.rounds.forEach((round, r) => {
    for (const s of round) {
      finish[s.home] = Math.max(finish[s.home], r + 1);
      finish[s.away] = Math.max(finish[s.away], r + 1);
    }
  });
  finish[state.champion] = 5;
  return finish;
};

export const seasonSummary = (state) => {
  const final = state.playoffs.rounds.at(-1)[0];
  const finish = playoffFinish(state);
  const skaters = state.players.filter((p) => p.stats?.gp && p.pos !== "G");
  const goalies = state.players.filter((p) => p.stats?.gs && p.pos === "G");
  return {
    season: state.season,
    champion: state.champion,
    runnerUp: final.winner === final.home ? final.away : final.home,
    final: final.winner === final.home ? final.wins : [...final.wins].reverse(),
    // [tid, w, l, otl, gf, ga, playoff finish]
    teams: state.teams.map((t) => [
      t.tid,
      t.record.w,
      t.record.l,
      t.record.otl,
      t.record.gf,
      t.record.ga,
      finish[t.tid],
    ]),
    conferenceWinners: Object.keys(standings(state)).map(
      (conf) => state.teams.filter((t) => t.conf === conf).sort((a, b) => points(b.record) - points(a.record))[0].tid,
    ),
    leaders: {
      points: leader(skaters, (s) => s.g + s.a),
      goals: leader(skaters, (s) => s.g),
      wins: leader(goalies, (s) => s.w),
      savePct: leader(
        goalies,
        (s) => Math.round((1 - s.ga / s.sa) * 1000) / 1000,
        (p) => p.stats.gs >= 25,
      ),
    },
  };
};

export const canStartNextSeason = (state) => state.phase === "done";

// Runs the draft, or what's left of it, with your scouts picking for you.
export const finishDraftForYou = (state) => {
  const rng = makeRng(0);
  rng.state = state.rngState;
  startDraft(state, rng);
  state.rngState = rng.state;
  runDraft(state, { auto: true });
};

// Holds the lottery and lets the CPU teams pick until it's your turn.
export const beginDraft = (state) => {
  const rng = makeRng(0);
  rng.state = state.rngState;
  startDraft(state, rng);
  state.rngState = rng.state;
  return runDraft(state);
};

// Free agency opens: the draft finishes, the season goes into the history
// and every career, everyone gets a year older, veterans retire, contracts
// run out (CPU teams re-sign who they want) and everyone left without one
// goes to market for five bidding rounds.
export const canOpenFreeAgency = (state) => state.phase === "done" && !state.fa;

export const openFreeAgency = (state) => {
  if (!canOpenFreeAgency(state)) throw new Error("Free agency opens once the season is over.");
  if (!draftDone(state)) finishDraftForYou(state);
  state.history.push(seasonSummary(state));
  const outliers = seasonOutliers(state);
  applyOutliers(state, outliers);

  for (const p of state.players) {
    if (p.tid === RETIRED) continue;
    if (p.stats.gp || p.playoffStats.gp) {
      p.career.push({
        season: state.season,
        tid: p.tid,
        pos: p.pos,
        stats: compactStats(p.stats),
        playoffStats: p.playoffStats.gp ? compactStats(p.playoffStats) : null,
      });
    }
    p.stats = emptyStats();
    p.playoffStats = emptyStats();
    p.age++;
  }

  const rng = makeRng(0);
  rng.state = state.rngState;
  summerRetirements(state, rng);
  state.rngState = rng.state;
  contractSummer(state);
  if (state.teams[state.userTid]) fillLines(state, state.userTid);
  // Breakouts get their stone evolutions at training camp.
  return openMarket(state, { breakouts: outliers.breakouts.map((p) => p.pid) });
};

// One bidding round. Your lines are refilled if you signed anyone.
export const nextRound = (state) => {
  if (!state.fa || state.fa.over) throw new Error("Free agency isn't open.");
  const signed = playRound(state);
  if (state.teams[state.userTid] && signed.some((s) => s.tid === state.userTid)) fillLines(state, state.userTid);
  return signed;
};

// Starts the next season. Whatever is left of the summer runs first, with
// nobody bidding for you: free agency opens and its rounds play out.
export const startNextSeason = (state) => {
  if (!canStartNextSeason(state)) throw new Error("The season isn't over yet.");
  if (!state.fa) openFreeAgency(state);
  playAllRounds(state);
  const summary = state.history.at(-1);
  summary.fa = [state.fa.pool, state.fa.signed];
  // Trades made this season and summer. Only the latest season's are kept in full.
  summary.trades = (state.trades ?? []).filter((t) => t.season === summary.season).length;
  if (state.trades) state.trades = state.trades.filter((t) => t.season === summary.season);
  const breakouts = state.fa.breakouts.map((pid) => state.players[pid]);

  const rng = makeRng(0);
  rng.state = state.rngState;
  // Before the records reset, so the weakest teams sign free agents first.
  summerRosters(state);
  if (state.teams[state.userTid]) fillLines(state, state.userTid);
  delete state.fa;

  for (const t of state.teams) {
    t.record = { w: 0, l: 0, otl: 0, gf: 0, ga: 0, row: 0, streak: "", last10: [] };
  }

  state.schedule = makeSchedule(state.teams, rng);
  state.rngState = rng.state;

  state.season++;
  trainingCamp(state, breakouts);
  // Next summer's draft class, there to scout all season.
  makeClass(state, rng);
  state.rngState = rng.state;
  state.phase = "regular";
  state.day = 0;
  state.games = [];
  state.playoffs = null;
  state.champion = null;
  state.news.unshift({ season: state.season, text: `The ${state.season} season begins. Everyone is a year older.` });
  state.news.length = Math.min(state.news.length, NEWS_KEPT);
  return state;
};
