// Between seasons: when the Cup is won, the season goes into the league's
// history, every player's stats go into his career, everyone gets a year
// older, and a new schedule starts the next season.

import { makeRng } from "./random.js";
import { makeSchedule } from "./schedule.js";
import { points, standings } from "./season.js";
import { emptyStats } from "./league.js";

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
  const skaters = state.players.filter((p) => p.stats.gp && p.pos !== "G");
  const goalies = state.players.filter((p) => p.stats.gs && p.pos === "G");
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

export const startNextSeason = (state) => {
  if (!canStartNextSeason(state)) throw new Error("The season isn't over yet.");
  state.history.push(seasonSummary(state));

  for (const p of state.players) {
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

  for (const t of state.teams) {
    t.record = { w: 0, l: 0, otl: 0, gf: 0, ga: 0, row: 0, streak: "", last10: [] };
  }

  const rng = makeRng(0);
  rng.state = state.rngState;
  state.schedule = makeSchedule(state.teams, rng);
  state.rngState = rng.state;

  state.season++;
  state.phase = "regular";
  state.day = 0;
  state.games = [];
  state.playoffs = null;
  state.champion = null;
  state.news.unshift({ season: state.season, text: `The ${state.season} season begins. Everyone is a year older.` });
  state.news.length = Math.min(state.news.length, NEWS_KEPT);
  return state;
};
