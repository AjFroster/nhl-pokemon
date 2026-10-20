// Golden seeds: fixed leagues whose results are committed in this folder.
// If a change alters how any of them plays out, the golden test fails and
// shows what changed. Run `npm run golden:update` to accept the new results,
// and commit the JSON files so the change is visible in review.

import fs from "node:fs";
import { createLeague } from "../../src/league.js";
import { playDay, standings, points } from "../../src/season.js";
import { stateHash } from "../../src/hash.js";

const dex = JSON.parse(fs.readFileSync(new URL("../../data/pokedex.json", import.meta.url), "utf8"));

// The browser play test replays "season-seed-1" with ?seed=1 and team 1.
export const CASES = [
  { name: "create-seed-1", seed: 1, userTid: 1, play: false },
  { name: "season-seed-1", seed: 1, userTid: 1, play: true },
  { name: "season-seed-2", seed: 2, userTid: 12, play: true },
];

export const goldenFile = (name) => new URL(`${name}.json`, import.meta.url);

const best = (p) => Math.max(...Object.values(p.ovrs));
const label = (state, p) => `${p.name} (${p.tid >= 0 ? state.teams[p.tid].abbr : "FA"})`;

// A short, readable account of a league, so a diff says what changed.
export const summarize = (state) => {
  const teamsByOvr = [...state.teams].sort((a, b) => b.ovr - a.ovr);
  const out = {
    seed: state.seed,
    season: state.season,
    phase: state.phase,
    day: state.day,
    scheduleDays: state.schedule.length,
    firstOverallPick: state.news.at(-1).text,
    bestTeams: teamsByOvr.slice(0, 5).map((t) => `${t.abbr} ${t.ovr.toFixed(1)}`),
    worstTeams: teamsByOvr.slice(-3).map((t) => `${t.abbr} ${t.ovr.toFixed(1)}`),
    bestPlayers: [...state.players]
      .sort((a, b) => best(b) - best(a) || a.pid - b.pid)
      .slice(0, 5)
      .map((p) => `${label(state, p)} ${best(p)}`),
  };
  if (state.games.length) {
    const st = standings(state);
    out.conferenceLeaders = Object.fromEntries(
      Object.entries(st).map(([conf, divs]) => [
        conf,
        Object.values(divs)
          .flat()
          .sort((a, b) => points(b.record) - points(a.record))
          .slice(0, 3)
          .map((t) => `${t.abbr} ${points(t.record)} pts`),
      ]),
    );
    const scorers = state.players
      .filter((p) => p.stats.gp)
      .sort((a, b) => b.stats.g + b.stats.a - (a.stats.g + a.stats.a) || a.pid - b.pid)
      .slice(0, 5);
    out.topScorers = scorers.map((p) => `${label(state, p)} ${p.stats.g}G ${p.stats.a}A`);
    out.games = state.games.length;
    out.goals = state.games.reduce((s, g) => s + g.score[0] + g.score[1], 0);
  }
  if (state.champion != null) {
    const final = state.playoffs.rounds.at(-1)[0];
    out.champion = state.teams[state.champion].abbr;
    out.final = `${state.teams[final.home].abbr} ${final.wins[0]}-${final.wins[1]} ${state.teams[final.away].abbr}`;
  }
  out.stateHash = stateHash(state);
  return out;
};

export const runCase = ({ seed, userTid, play }) => {
  const state = createLeague({ dex, seed, userTid });
  if (play) for (let i = 0; i < 400 && state.phase !== "done"; i++) playDay(state);
  return summarize(state);
};
