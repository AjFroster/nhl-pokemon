// Playing the season: regular-season days, standings, playoffs and the
// roster moves a GM can make along the way.

import { simGame, leagueNorm } from "./sim.js";
import { makeRng } from "./random.js";
import { RULES } from "./ratings.js";
import { teamOvr } from "./league.js";
import { awardGameXp } from "./growth.js";

export const points = (r) => 2 * r.w + r.otl;
export const gamesPlayed = (r) => r.w + r.l + r.otl;

// NHL order: points, then fewer games played, regulation-plus-OT wins, goal differential.
export const compareTeams = (a, b) =>
  points(b.record) - points(a.record) ||
  gamesPlayed(a.record) - gamesPlayed(b.record) ||
  b.record.row - a.record.row ||
  b.record.gf - b.record.ga - (a.record.gf - a.record.ga) ||
  a.tid - b.tid;

export const standings = (state) => {
  const confs = {};
  for (const t of state.teams) {
    const conf = (confs[t.conf] ??= {});
    (conf[t.div] ??= []).push(t);
  }
  for (const conf of Object.values(confs)) for (const div of Object.values(conf)) div.sort(compareTeams);
  return confs;
};

export const conferenceRanking = (state, conf) => state.teams.filter((t) => t.conf === conf).sort(compareTeams);

const addStats = (s, line) => {
  s.gp++;
  for (const k of ["g", "a", "pm", "pim", "sog", "hit", "blk", "toi", "ppg"]) s[k] += line[k];
};

const recordGame = (team, gf, ga, result) => {
  const r = team.record;
  r.gf += gf;
  r.ga += ga;
  const won = gf > ga;
  if (won) {
    r.w++;
    if (!result.so) r.row++;
  } else if (result.ot) r.otl++;
  else r.l++;
  const code = won ? "W" : result.ot ? "O" : "L";
  r.last10 = [...r.last10, code].slice(-10);
  const prev = r.streak;
  r.streak = prev && prev[0] === code ? `${code}${Number(prev.slice(1)) + 1}` : `${code}1`;
};

// Fold one simulated game into team records, player stats and the game log.
export const applyResult = (state, result, { day, series } = {}) => {
  const playoffs = result.playoffs;
  const tids = [result.home, result.away];
  if (!playoffs) {
    recordGame(state.teams[result.home], result.score[0], result.score[1], result);
    recordGame(state.teams[result.away], result.score[1], result.score[0], result);
  }
  const key = playoffs ? "playoffStats" : "stats";
  for (const [pid, line] of Object.entries(result.lines)) addStats(state.players[pid][key], line);
  for (const g of result.goals) if (g.gwg) state.players[g.pid][key].gwg++;
  for (const [t, g] of result.goalies.entries()) {
    if (g.pid == null) continue;
    const s = state.players[g.pid][key];
    s.gp++;
    s.gs++;
    s.toi += g.toi;
    s.sa += g.sa;
    s.ga += g.ga;
    if (g.dec === "W") s.w++;
    else if (g.dec === "OTL") s.otl++;
    else s.l++;
    if (g.dec === "W" && result.score[1 - t] === 0) s.so++;
  }

  awardGameXp(state, result);

  const gid = state.games.length;
  const involvesUser = tids.includes(state.userTid);
  state.games.push({
    gid,
    day,
    season: state.season,
    home: result.home,
    away: result.away,
    score: result.score,
    shots: result.shots,
    periods: result.periods,
    ot: result.ot,
    so: result.so ? { made: result.so.made } : null,
    goals: result.goals.map(({ t, period, time, pid, assists, pp, sh, en, gwg }) => ({
      t,
      period,
      time,
      pid,
      assists,
      pp,
      sh,
      en,
      gwg,
    })),
    penalties: result.penalties,
    goalies: result.goalies,
    // Full player lines are kept for your own games so their box scores are complete.
    lines: involvesUser ? result.lines : null,
    playoffs,
    series,
  });
  return gid;
};

const sim = (state, home, away, rng, playoffs, norm) =>
  simGame({ home: state.teams[home], away: state.teams[away], byPid: state.players, rng, playoffs, norm });

// ---- Playoffs ----

const makeSeries = (state, a, b) => {
  const [hi, lo] = [state.teams[a], state.teams[b]].sort(compareTeams);
  return { home: hi.tid, away: lo.tid, seeds: [null, null], wins: [0, 0], games: [], winner: null };
};

export const startPlayoffs = (state) => {
  const perConf = RULES.playoffTeams / 2;
  const round = [];
  for (const conf of Object.keys(standings(state))) {
    const seeds = conferenceRanking(state, conf)
      .slice(0, perConf)
      .map((t) => t.tid);
    // Bracket order keeps 1 v 8 and 4 v 5 on the same side.
    for (const [i, j] of [
      [0, 7],
      [3, 4],
      [1, 6],
      [2, 5],
    ]) {
      const s = makeSeries(state, seeds[i], seeds[j]);
      s.seeds = [i + 1, j + 1];
      s.conf = conf;
      round.push(s);
    }
  }
  state.phase = "playoffs";
  state.playoffs = { rounds: [round], day: 0 };
  state.news.unshift({ season: state.season, text: "The regular season is over. The playoffs begin." });
};

const HOME_PATTERN = [0, 0, 1, 1, 0, 1, 0]; // 2-2-1-1-1, 0 = higher seed at home

const playPlayoffDay = (state, rng, norm) => {
  const po = state.playoffs;
  const round = po.rounds[po.rounds.length - 1];
  const need = Math.ceil(RULES.playoffSeriesLength / 2);
  for (const [i, s] of round.entries()) {
    if (s.winner != null) continue;
    const gameNum = s.wins[0] + s.wins[1];
    const higherHome = HOME_PATTERN[gameNum] === 0;
    const [home, away] = higherHome ? [s.home, s.away] : [s.away, s.home];
    const result = sim(state, home, away, rng, true, norm);
    const gid = applyResult(state, result, {
      day: `P${po.day}`,
      series: { round: po.rounds.length - 1, index: i, game: gameNum + 1 },
    });
    s.games.push(gid);
    const homeWon = result.score[0] > result.score[1];
    const winnerTid = homeWon ? home : away;
    s.wins[winnerTid === s.home ? 0 : 1]++;
    if (s.wins[0] === need || s.wins[1] === need) s.winner = s.wins[0] === need ? s.home : s.away;
  }
  po.day++;

  if (round.every((s) => s.winner != null)) {
    if (round.length === 1) {
      state.champion = round[0].winner;
      state.phase = "done";
      const t = state.teams[state.champion];
      state.news.unshift({ season: state.season, text: `The ${t.city} ${t.name} win the ${state.season} Cup!` });
      return;
    }
    const next = [];
    for (let i = 0; i < round.length; i += 2) {
      const s = makeSeries(state, round[i].winner, round[i + 1].winner);
      s.conf = round[i].conf === round[i + 1].conf ? round[i].conf : null;
      next.push(s);
    }
    po.rounds.push(next);
  }
};

// ---- Days ----

export const dayLabel = (state) => {
  if (state.phase === "regular") return `Day ${state.day + 1} of ${state.schedule.length}`;
  if (state.phase === "playoffs") return ROUND_NAMES[state.playoffs.rounds.length - 1];
  return "Season over";
};
export const ROUND_NAMES = ["First round", "Second round", "Conference finals", "Cup final"];

export const canPlay = (state) => {
  if (state.phase === "done") return { ok: false, why: "The season is over. Start the next one from the top bar." };
  const roster = state.players.filter((p) => p.tid === state.userTid);
  if (roster.length < RULES.minRoster)
    return { ok: false, why: `You need at least ${RULES.minRoster} players to play. Sign a free agent.` };
  if (roster.length > RULES.rosterMax)
    return { ok: false, why: `You can carry at most ${RULES.rosterMax} players. Release someone first.` };
  const lines = state.teams[state.userTid].lines;
  const slots = [...lines.F.flat(), ...lines.D.flat(), ...lines.G];
  if (slots.some((pid) => pid == null)) return { ok: false, why: "Every spot in your lines needs a player." };
  return { ok: true };
};

export const playDay = (state) => {
  const rng = makeRng(0);
  rng.state = state.rngState;
  // Measured once a day, so every game that day uses the same yardstick.
  const norm = leagueNorm(state.teams, state.players);
  if (state.phase === "regular") {
    for (const g of state.schedule[state.day]) {
      applyResult(state, sim(state, g.home, g.away, rng, false, norm), { day: state.day });
    }
    state.day++;
    if (state.day >= state.schedule.length) startPlayoffs(state);
  } else if (state.phase === "playoffs") {
    playPlayoffDay(state, rng, norm);
  }
  state.rngState = rng.state;
};

export const userSeries = (state) => {
  if (!state.playoffs) return null;
  const round = state.playoffs.rounds[state.playoffs.rounds.length - 1];
  return round.find((s) => s.home === state.userTid || s.away === state.userTid) ?? null;
};

export const userGameToday = (state) => {
  if (state.phase === "regular")
    return state.schedule[state.day]?.find((g) => g.home === state.userTid || g.away === state.userTid) ?? null;
  const s = userSeries(state);
  return s && s.winner == null ? s : null;
};

// ---- Roster moves ----

// Keep everyone already in the lines; fill any empty spot with the best player not dressed.
export const fillLines = (state, tid) => {
  const team = state.teams[tid];
  const roster = state.players.filter((p) => p.tid === tid);
  const onRoster = new Set(roster.map((p) => p.pid));
  const L = team.lines;
  const clean = (pid) => (pid != null && onRoster.has(pid) ? pid : null);
  L.F = L.F.map((l) => l.map(clean));
  L.D = L.D.map((l) => l.map(clean));
  L.G = L.G.map(clean);
  const used = new Set([...L.F.flat(), ...L.D.flat(), ...L.G].filter((x) => x != null));
  const bestFor = (pos) => {
    const p = roster.filter((x) => !used.has(x.pid)).sort((a, b) => b.ovrs[pos] - a.ovrs[pos])[0];
    if (!p) return null;
    used.add(p.pid);
    return p.pid;
  };
  L.G = L.G.map((pid) => pid ?? bestFor("G"));
  L.D = L.D.map((pair) => pair.map((pid) => pid ?? bestFor("D")));
  L.F = L.F.map((l) => l.map((pid, i) => pid ?? bestFor(i === 0 ? "C" : "W")));
  team.ovr = teamOvr(team, state.players);
};

export const releasePlayer = (state, pid) => {
  const p = state.players[pid];
  const tid = p.tid;
  p.tid = -1;
  p.jersey = null;
  p.faSince = state.season;
  fillLines(state, tid);
  const t = state.teams[tid];
  state.news.unshift({ season: state.season, text: `The ${t.city} ${t.name} released ${p.name}.` });
};

export const signPlayer = (state, pid, tid = state.userTid) => {
  const p = state.players[pid];
  const roster = state.players.filter((x) => x.tid === tid);
  if (p.tid !== -1) return { ok: false, why: `${p.name} is already on a team.` };
  if (roster.length >= RULES.rosterMax)
    return { ok: false, why: `Your roster is full at ${RULES.rosterMax}. Release someone first.` };
  if (p.legendary && roster.filter((x) => x.legendary).length >= RULES.maxLegendariesPerTeam)
    return { ok: false, why: `You already have a Legendary. Teams may carry ${RULES.maxLegendariesPerTeam}.` };
  p.tid = tid;
  p.pos = p.natural;
  p.faSince = null;
  const used = new Set(roster.map((x) => x.jersey));
  let n = 2;
  while (used.has(n)) n++;
  p.jersey = n;
  fillLines(state, tid);
  const t = state.teams[tid];
  state.news.unshift({ season: state.season, text: `The ${t.city} ${t.name} signed ${p.name}.` });
  return { ok: true };
};
