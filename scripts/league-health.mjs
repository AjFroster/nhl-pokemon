// League health: plays whole seasons without a browser and checks that the
// league stays sane. Hard rules (82 games, legal rosters, a full bracket) must
// always hold. Game-feel numbers (goals, saves, overtime) must stay in bands.
//
//   node scripts/league-health.mjs --seed 1 --seasons 10 [--leagues 4] [--out health/seed-1.json] [--workers 4]
//
// A run plays several leagues (4 by default), each for a number of seasons in
// a row: the Cup is won, the next season starts, and so on. Seasons of one
// league must run in order, so the leagues run in parallel instead, one per
// worker thread. Each league has its own seed, so the results are the same
// however many threads run.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { createLeague } from "../src/league.js";
import { playDay, points } from "../src/season.js";
import { startNextSeason } from "../src/offseason.js";
import { RULES } from "../src/ratings.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url), "utf8"));

// Bands for one season of 1,312 games. They were set by simulating 120
// leagues and taking about five standard deviations either side of the mean,
// so a healthy league practically never trips them but a broken sim does.
// Recalibrate with `npm run health -- --calibrate 120` after an intended change.
export const BANDS = {
  goalsPerTeamGame: [2.72, 3.5],
  shotsPerTeamGame: [29.5, 32.5],
  savePct: [0.89, 0.916],
  overtimeShare: [0.12, 0.23],
  shootoutShare: [0.055, 0.15],
  homeWinPct: [0.45, 0.59],
  pimPerTeamGame: [5.6, 6.6],
  ovrPointsCorrelation: [0.2, 1],
  bestTeamPoints: [95, 145],
  worstTeamPoints: [25, 90],
  topScorerPoints: [80, 155],
};

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const corr = (xs, ys) => {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
};

export const metrics = (state) => {
  const games = state.games.filter((g) => !g.playoffs);
  const teamGames = games.length * 2;
  let goals = 0;
  let shots = 0;
  let sa = 0;
  let ga = 0;
  let pim = 0;
  for (const g of games) {
    goals += g.score[0] + g.score[1];
    shots += g.shots[0] + g.shots[1];
    for (const gl of g.goalies) {
      sa += gl.sa;
      ga += gl.ga;
    }
    for (const p of g.penalties ?? []) pim += p.min ?? 2;
  }
  const pts = state.teams.map((t) => points(t.record));
  const skaterPts = state.players.map((p) => p.stats.g + p.stats.a);
  return {
    goalsPerTeamGame: goals / teamGames,
    shotsPerTeamGame: shots / teamGames,
    savePct: 1 - ga / sa,
    overtimeShare: games.filter((g) => g.ot).length / games.length,
    shootoutShare: games.filter((g) => g.so).length / games.length,
    homeWinPct: games.filter((g) => g.score[0] > g.score[1]).length / games.length,
    pimPerTeamGame: pim / teamGames,
    ovrPointsCorrelation: corr(
      state.teams.map((t) => t.ovr),
      pts,
    ),
    bestTeamPoints: Math.max(...pts),
    worstTeamPoints: Math.min(...pts),
    topScorerPoints: Math.max(...skaterPts),
  };
};

// Rules that must hold exactly. Each returns a list of problems.
export const ruleProblems = (state) => {
  const problems = [];
  const bad = (msg) => problems.push(msg);
  const gp = Array(state.teams.length).fill(0);
  const home = Array(state.teams.length).fill(0);
  for (const g of state.games.filter((x) => !x.playoffs)) {
    gp[g.home]++;
    gp[g.away]++;
    home[g.home]++;
    if (g.score[0] === g.score[1]) bad(`game ${g.gid} ended in a tie`);
  }
  for (const t of state.teams) {
    const r = t.record;
    if (gp[t.tid] !== RULES.gamesPerSeason) bad(`${t.abbr} played ${gp[t.tid]} games`);
    if (home[t.tid] !== RULES.gamesPerSeason / 2) bad(`${t.abbr} had ${home[t.tid]} home games`);
    if (r.w + r.l + r.otl !== RULES.gamesPerSeason) bad(`${t.abbr} record adds up to ${r.w + r.l + r.otl}`);
    const roster = state.players.filter((p) => p.tid === t.tid);
    if (roster.length < RULES.minRoster || roster.length > RULES.rosterMax)
      bad(`${t.abbr} has ${roster.length} players`);
    const legends = roster.filter((p) => p.legendary).length;
    if (legends > RULES.maxLegendariesPerTeam) bad(`${t.abbr} has ${legends} Legendaries`);
    const dressed = [...t.lines.F.flat(), ...t.lines.D.flat(), ...t.lines.G].filter((pid) => pid != null);
    if (new Set(dressed).size !== dressed.length) bad(`${t.abbr} dresses a player twice`);
    if (dressed.some((pid) => state.players[pid].tid !== t.tid)) bad(`${t.abbr} dresses a player from another team`);
    if (dressed.length < 20) bad(`${t.abbr} dresses only ${dressed.length} players`);
  }
  const wins = state.teams.reduce((s, t) => s + t.record.w, 0);
  if (wins !== state.games.filter((x) => !x.playoffs).length) bad(`${wins} wins in ${state.games.length} games`);
  for (const p of state.players) {
    for (const [k, v] of Object.entries(p.stats)) {
      if (!Number.isFinite(v) || (v < 0 && k !== "pm")) bad(`${p.name} has ${k} = ${v}`);
    }
  }
  const rounds = state.playoffs?.rounds ?? [];
  const need = Math.ceil(RULES.playoffSeriesLength / 2);
  if (rounds.map((r) => r.length).join(",") !== "8,4,2,1")
    bad(`playoff rounds have ${rounds.map((r) => r.length)} series`);
  for (const s of rounds.flat()) {
    if (Math.max(...s.wins) !== need || Math.min(...s.wins) >= need) bad(`a series ended ${s.wins.join("-")}`);
  }
  if (state.phase !== "done" || state.champion == null) bad("no champion was crowned");
  return problems;
};

const playToCup = (state) => {
  for (let i = 0; i < 400 && state.phase !== "done"; i++) playDay(state);
  return state;
};

// One fresh league played to a champion.
export const playSeason = (seed) => playToCup(createLeague({ dex, seed, userTid: 0 }));

export const checkSeason = (state) => {
  const m = metrics(state);
  const failures = ruleProblems(state).map((msg) => ({ check: "rule", msg }));
  for (const [k, [lo, hi]] of Object.entries(BANDS)) {
    if (!(m[k] >= lo && m[k] <= hi)) failures.push({ check: k, msg: `${k} = ${round(m[k])}, outside ${lo} to ${hi}` });
  }
  return { metrics: m, failures };
};

// A saved league may grow by this much a season (history and career lines).
export const MAX_SAVE_GROWTH_PER_SEASON = 200_000;

// Checks across a rollover: the season went into the history, everyone aged a
// year, rosters carried over, and the save didn't balloon.
export const rolloverProblems = (before, after, sizeBefore, sizeAfter) => {
  const problems = [];
  if (after.season !== before.season + 1) problems.push(`the season went from ${before.season} to ${after.season}`);
  if (after.history.at(-1)?.season !== before.season)
    problems.push(`the ${before.season} season is missing from history`);
  if (after.players.some((p, i) => p.age !== before.players[i].age + 1)) problems.push("not every player aged a year");
  if (after.players.some((p, i) => p.tid !== before.players[i].tid)) problems.push("rosters changed over the summer");
  if (sizeAfter - sizeBefore > MAX_SAVE_GROWTH_PER_SEASON)
    problems.push(`the save grew ${Math.round((sizeAfter - sizeBefore) / 1000)} KB in a season`);
  return problems;
};

const round = (x) => Math.round(x * 1000) / 1000;

// Plays one league for several seasons in a row, checking every season.
const playLeague = ({ league, leagueSeed, seasons }) => {
  const state = createLeague({ dex, seed: leagueSeed, userTid: 0 });
  const results = [];
  let prev = null;
  for (let season = 1; season <= seasons; season++) {
    if (prev) startNextSeason(state);
    playToCup(state);
    const size = JSON.stringify(state).length;
    const { metrics: m, failures } = checkSeason(state);
    if (prev) {
      for (const msg of rolloverProblems(prev.state, state, prev.size, size)) failures.push({ check: "rollover", msg });
    }
    results.push({
      league,
      leagueSeed,
      season,
      year: state.season,
      champion: state.teams[state.champion]?.abbr ?? null,
      metrics: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, round(v)])),
      failures,
    });
    // Only what the rollover checks need from the finished season.
    prev = { state: { season: state.season, players: state.players.map(({ age, tid }) => ({ age, tid })) }, size };
  }
  return results;
};

// Plays leagues on a pool of worker threads, handing each free worker the next league.
const playInParallel = (jobs, workers) =>
  new Promise((resolve, reject) => {
    const results = [];
    let next = 0;
    let running = 0;
    const startWorker = () => {
      const worker = new Worker(new URL(import.meta.url), { workerData: { healthWorker: true } });
      const feed = () => {
        if (next >= jobs.length) {
          worker.terminate();
          if (--running === 0) resolve(results);
          return;
        }
        worker.postMessage(jobs[next++]);
      };
      worker.on("message", (leagueResults) => {
        results.push(...leagueResults);
        feed();
      });
      worker.on("error", reject);
      running++;
      feed();
    };
    for (let i = 0; i < Math.min(workers, jobs.length); i++) startWorker();
  });

export const runHealth = async ({ seed, seasons, leagues = 4, workers = os.availableParallelism() }) => {
  const jobs = Array.from({ length: leagues }, (_, i) => ({ league: i + 1, leagueSeed: seed * 1000 + i, seasons }));
  const results = workers > 1 ? await playInParallel(jobs, workers) : jobs.flatMap(playLeague);
  results.sort((a, b) => a.league - b.league || a.season - b.season);
  return { seed, seasons, leagues, bands: BANDS, results, ok: results.every((r) => r.failures.length === 0) };
};

if (!isMainThread && workerData?.healthWorker) {
  parentPort.on("message", (job) => parentPort.postMessage(playLeague(job)));
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
};

if (isMainThread && import.meta.url === `file://${process.argv[1]}`) {
  const calibrate = Number(arg("calibrate", 0));
  if (calibrate) {
    // Prints the spread of every measure over many leagues, to set BANDS.
    const all = {};
    for (let i = 0; i < calibrate; i++) {
      for (const [k, v] of Object.entries(metrics(playSeason(777000 + i * 7919)))) (all[k] ??= []).push(v);
    }
    for (const [k, xs] of Object.entries(all)) {
      const m = mean(xs);
      const sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
      console.log(
        `${k.padEnd(22)} min ${round(Math.min(...xs))}  mean ${round(m)}  max ${round(Math.max(...xs))}  sd ${round(sd)}`,
      );
    }
    process.exit(0);
  }
  const seed = Number(arg("seed", 1));
  const seasons = Number(arg("seasons", 10));
  const leagues = Number(arg("leagues", 4));
  const out = arg("out", null);
  const workers = Number(arg("workers", os.availableParallelism()));
  const started = performance.now();
  const report = await runHealth({ seed, seasons, leagues, workers });
  const threads = Math.min(workers, leagues);
  console.log(
    `Played ${leagues} leagues of ${seasons} seasons on ${threads} thread${threads === 1 ? "" : "s"} in ${((performance.now() - started) / 1000).toFixed(1)}s`,
  );
  for (const r of report.results) {
    const m = r.metrics;
    console.log(
      `league ${r.league} (seed ${r.leagueSeed})  ${r.year}  ` +
        `G/GP ${m.goalsPerTeamGame.toFixed(2)}  SV ${m.savePct.toFixed(3)}  OT ${m.overtimeShare.toFixed(2)}  ` +
        `home ${m.homeWinPct.toFixed(3)}  champion ${r.champion}  ${r.failures.length ? "FAIL" : "ok"}`,
    );
    for (const f of r.failures) console.log(`    ${f.msg}`);
  }
  if (out) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (!report.ok) {
    console.log(
      `\nSeason simulation health failed. Replay with: npm run health -- --seed ${seed} --seasons ${seasons} --leagues ${leagues}`,
    );
    process.exitCode = 1;
  }
}
