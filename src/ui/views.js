// Screens of the game, each a function from the league state to HTML.

import { SKILLS, RULES } from "../ratings.js";
import { standings, points, gamesPlayed, conferenceRanking, ROUND_NAMES, userSeries, dayLabel } from "../season.js";
import { lineupOvrs } from "../league.js";

export const TYPE_COLORS = {
  Normal: "#c6c6a7", Fire: "#f5ac78", Water: "#9db7f5", Electric: "#fae078", Grass: "#a7db8d", Ice: "#bce6e6",
  Fighting: "#d67873", Poison: "#c183c1", Ground: "#ebd69d", Flying: "#c6b7f5", Psychic: "#fa92b2", Bug: "#c6d16e",
  Rock: "#d1c17d", Ghost: "#a292bc", Dragon: "#a27dfa", Dark: "#a29288", Steel: "#d1d1e0", Fairy: "#f4bdc9",
};
const POS_NAMES = { C: "Center", W: "Wing", D: "Defense", G: "Goalie" };

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
export const teamName = (t) => `${t.city} ${t.name}`;
const badge = (t) => `<span class="badge" style="--tc:${TYPE_COLORS[t.type]}">${t.abbr}</span>`;
const typeChips = (types) => `<span class="types">${types.map((x) => `<span class="type" style="background:${TYPE_COLORS[x]}">${x}</span>`).join("")}</span>`;
const teamLink = (t, full = false) => `<button class="link team" data-go="team" data-tid="${t.tid}">${badge(t)}${full ? `<span>${esc(teamName(t))}</span>` : ""}</button>`;
const playerLink = (p) => `<button class="link" data-player="${p.pid}">${esc(p.name)}</button>`;
const toi = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const svp = (s) => (s.sa ? (1 - s.ga / s.sa).toFixed(3).replace(/^0/, "") : "—");
const gaa = (s) => (s.toi ? ((s.ga * 3600) / s.toi).toFixed(2) : "—");
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const record = (r) => `${r.w}-${r.l}-${r.otl}`;
const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const periodName = (n, playoffs) => (n <= 3 ? `${["1st", "2nd", "3rd"][n - 1]}` : playoffs ? `OT${n - 3 > 1 ? n - 3 : ""}` : "OT");

const roster = (state, tid) => state.players.filter((p) => p.tid === tid);
const empty = (text) => `<p class="empty">${text}</p>`;

// ---------- Shell ----------

export const header = (state, ui) => {
  const t = state.teams[state.userTid];
  const busy = ui.busy;
  const options = [];
  if (state.phase === "regular") {
    options.push(["day", "Next day"], ["week", "One week"], ["month", "One month"], ["regular", "Until the playoffs"]);
  } else if (state.phase === "playoffs") {
    options.push(["day", "Next day"], ["round", "Until the round ends"], ["playoffs", "Until a champion is crowned"]);
  }
  return `
  <div class="bar">
    <div class="bar-team">
      ${badge(t)}
      <div>
        <div class="bar-name">${esc(teamName(t))}</div>
        <div class="bar-sub">${state.season} · ${record(t.record)} · ${points(t.record)} pts · ${esc(dayLabel(state))}</div>
      </div>
    </div>
    <div class="bar-play">
      ${busy
        ? `<span class="progress">${esc(ui.busyText || "Playing…")}</span><button class="btn" data-action="stop">Stop</button>`
        : options.length
          ? `<span class="play-label">Play</span>${options.map(([k, label]) => `<button class="btn${k === "day" ? " primary" : ""}" data-play="${k}">${label}</button>`).join("")}`
          : `<span class="play-label">Season over</span>`}
    </div>
  </div>
  ${ui.notice ? `<div class="notice" role="status">${esc(ui.notice)}</div>` : ""}
  <nav class="tabs" aria-label="Screens">
    ${[
      ["home", "Dashboard"], ["standings", "Standings"], ["roster", "Roster"], ["lines", "Lines"], ["schedule", "Schedule"],
      ["playoffs", "Playoffs"], ["leaders", "Leaders"], ["free", "Free agents"],
    ].map(([k, label]) => `<button class="tab" data-go="${k}" aria-current="${ui.view === k ? "page" : "false"}">${label}</button>`).join("")}
  </nav>`;
};

// ---------- New league ----------

export const newLeagueView = (draft) => {
  const byDiv = {};
  for (const t of draft.teams) (byDiv[t.div] ??= []).push(t);
  return `
  <section class="hero">
    <div class="eyebrow">Pokémon NHL</div>
    <h1>Pick your franchise</h1>
    <p class="lede">Thirty-two Gym Leader teams just ran a snake fantasy draft over all 1,025 Pokémon. Choose the team you want to run. You'll set its lines, sign free agents and play an 82-game season and the playoffs.</p>
    <div class="row"><button class="btn" data-action="redraft">Run the draft again</button><span class="note">Draft #${draft.seed}</span></div>
  </section>
  <div class="divgrid">
    ${Object.entries(byDiv).map(([div, teams]) => `
      <div class="panel">
        <h3>${div}</h3>
        <div class="pickgrid">
          ${teams.sort((a, b) => b.ovr - a.ovr).map((t) => {
            const stars = roster(draft, t.tid).sort((a, b) => b.ovrs[b.pos] - a.ovrs[a.pos]).slice(0, 3);
            return `<button class="pick" data-pick="${t.tid}" style="--tc:${TYPE_COLORS[t.type]}">
              <span class="pick-top">${badge(t)}<span class="pick-ovr">${t.ovr}<small>OVR</small></span></span>
              <span class="pick-name">${esc(teamName(t))}</span>
              <span class="pick-sub">${esc(t.leader)} · ${t.type}</span>
              <span class="pick-stars">${stars.map((p) => esc(p.name)).join(", ")}</span>
            </button>`;
          }).join("")}
        </div>
      </div>`).join("")}
  </div>`;
};

// ---------- Dashboard ----------

const gameLine = (state, g, tid) => {
  const home = g.home === tid;
  const opp = state.teams[home ? g.away : g.home];
  const [us, them] = home ? [g.score[0], g.score[1]] : [g.score[1], g.score[0]];
  const res = us > them ? "W" : g.ot && !g.playoffs ? "OTL" : "L";
  const suffix = g.so ? " SO" : g.ot ? " OT" : "";
  return `<button class="gameline" data-game="${g.gid}">
    <span class="res res-${res === "W" ? "w" : "l"}">${res === "OTL" ? "OT" : res}</span>
    <span>${home ? "vs" : "@"} ${badge(opp)} ${esc(opp.city)}</span>
    <span class="score">${us}–${them}${suffix}</span>
  </button>`;
};

const scoreCard = (state, g) => {
  const h = state.teams[g.home];
  const a = state.teams[g.away];
  const suffix = g.so ? "SO" : g.ot ? "OT" : "Final";
  return `<button class="scorecard" data-game="${g.gid}">
    <span class="sc-row${g.score[1] > g.score[0] ? " won" : ""}">${badge(a)}<span>${esc(a.city)}</span><b>${g.score[1]}</b></span>
    <span class="sc-row${g.score[0] > g.score[1] ? " won" : ""}">${badge(h)}<span>${esc(h.city)}</span><b>${g.score[0]}</b></span>
    <span class="sc-foot">${suffix}${g.series ? ` · Game ${g.series.game}` : ""}</span>
  </button>`;
};

export const homeView = (state) => {
  const t = state.teams[state.userTid];
  const confRank = conferenceRanking(state, t.conf).findIndex((x) => x.tid === t.tid) + 1;
  const div = standings(state)[t.conf][t.div];
  const mine = state.games.filter((g) => g.home === t.tid || g.away === t.tid).slice(-6).reverse();
  const lastDay = state.games.length ? state.games[state.games.length - 1].day : null;
  const latest = state.games.filter((g) => g.day === lastDay).slice(-16);
  const leaders = state.players.filter((p) => p.tid >= 0 && p.stats.gp).sort((a, b) => b.stats.g + b.stats.a - (a.stats.g + a.stats.a) || b.stats.g - a.stats.g).slice(0, 6);
  const next = state.phase === "regular" ? state.schedule.slice(state.day).flat().find((g) => g.home === t.tid || g.away === t.tid) : null;
  const series = userSeries(state);
  const champ = state.champion != null ? state.teams[state.champion] : null;

  let nextHtml = "";
  if (champ) {
    nextHtml = `<div class="champ" style="--tc:${TYPE_COLORS[champ.type]}"><div class="eyebrow">${state.season} champions</div><div class="big">${esc(teamName(champ))}</div><p class="note">${champ.tid === t.tid ? "That's your team. Congratulations!" : "The franchise mode, with a second season, the draft and contracts, comes in step 3."}</p></div>`;
  } else if (next) {
    const opp = state.teams[next.home === t.tid ? next.away : next.home];
    nextHtml = `<div class="next"><div class="eyebrow">Next game</div><div class="vs">${next.home === t.tid ? "vs" : "@"} ${badge(opp)} <span>${esc(teamName(opp))}</span></div><p class="note">${record(opp.record)} · ${points(opp.record)} pts · team rating ${opp.ovr}</p></div>`;
  } else if (series) {
    const opp = state.teams[series.home === t.tid ? series.away : series.home];
    const [us, them] = series.home === t.tid ? series.wins : [...series.wins].reverse();
    nextHtml = `<div class="next"><div class="eyebrow">${ROUND_NAMES[state.playoffs.rounds.length - 1]}</div><div class="vs">vs ${badge(opp)} <span>${esc(teamName(opp))}</span></div><p class="note">${series.winner == null ? `Series ${us > them ? "lead" : us < them ? "trail" : "tied"} ${us}–${them}` : series.winner === t.tid ? `Won the series ${us}–${them}. Waiting for the next round.` : `Lost the series ${us}–${them}.`}</p></div>`;
  } else if (state.phase === "playoffs") {
    nextHtml = `<div class="next"><div class="eyebrow">Playoffs</div><p>Your season is over. You can keep playing to see who wins the Cup.</p></div>`;
  }

  return `
  <div class="grid home">
    <section class="panel span2">
      <div class="teamhead" style="--tc:${TYPE_COLORS[t.type]}">
        <div>
          <div class="eyebrow">${t.conf} Conference · ${t.div} Division</div>
          <h1>${esc(teamName(t))}</h1>
          <p class="note">Gym Leader ${esc(t.leader)} · ${typeChips([t.type])}</p>
        </div>
        <div class="stats4">
          <div><b>${record(t.record)}</b><span>Record</span></div>
          <div><b>${points(t.record)}</b><span>Points</span></div>
          <div><b>${gamesPlayed(t.record) ? ordinal(confRank) : "—"}</b><span>In conference</span></div>
          <div><b>${t.ovr}</b><span>Team rating</span></div>
        </div>
      </div>
      ${nextHtml}
    </section>
    <section class="panel">
      <h2>Your last games</h2>
      ${mine.length ? `<div class="gamelist">${mine.map((g) => gameLine(state, g, t.tid)).join("")}</div>` : empty("No games played yet. Press Next day to drop the puck.")}
    </section>
    <section class="panel">
      <h2>${esc(t.div)} Division</h2>
      ${standingsTable(state, div, { compact: true })}
    </section>
    <section class="panel span2">
      <h2>Latest scores</h2>
      ${latest.length ? `<div class="scores">${latest.map((g) => scoreCard(state, g)).join("")}</div>` : empty("Scores show up here once games are played.")}
    </section>
    <section class="panel">
      <h2>Points leaders</h2>
      ${leaders.length ? `<ol class="leaders">${leaders.map((p) => `<li>${badge(state.teams[p.tid])} ${playerLink(p)}<b>${p.stats.g + p.stats.a}</b></li>`).join("")}</ol>` : empty("No points yet.")}
    </section>
    <section class="panel">
      <h2>League news</h2>
      ${state.news.length ? `<ul class="news">${state.news.slice(0, 8).map((n) => `<li>${esc(n.text)}</li>`).join("")}</ul>` : empty("Nothing yet.")}
    </section>
  </div>`;
};

const ordinal = (n) => `${n}${["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

// ---------- Standings ----------

const standingsTable = (state, teams, { compact = false, cutoff = null } = {}) => `
  <div class="tablewrap"><table class="data">
    <thead><tr><th>Team</th><th class="num">GP</th><th class="num">W</th><th class="num">L</th><th class="num">OTL</th><th class="num">PTS</th>${compact ? "" : `<th class="num">ROW</th><th class="num">GF</th><th class="num">GA</th><th class="num">DIFF</th><th>STRK</th><th>L10</th>`}</tr></thead>
    <tbody>${teams.map((t, i) => {
      const r = t.record;
      const l10 = r.last10.reduce((a, c) => (c === "W" ? [a[0] + 1, a[1], a[2]] : c === "L" ? [a[0], a[1] + 1, a[2]] : [a[0], a[1], a[2] + 1]), [0, 0, 0]);
      return `<tr class="${t.tid === state.userTid ? "mine" : ""}${cutoff != null && i === cutoff - 1 ? " cut" : ""}">
        <td>${teamLink(t, true)}</td><td class="num">${gamesPlayed(r)}</td><td class="num">${r.w}</td><td class="num">${r.l}</td><td class="num">${r.otl}</td><td class="num strong">${points(r)}</td>
        ${compact ? "" : `<td class="num">${r.row}</td><td class="num">${r.gf}</td><td class="num">${r.ga}</td><td class="num">${signed(r.gf - r.ga)}</td><td>${r.streak ? r.streak.replace(/^O/, "OT") : "—"}</td><td>${l10.join("-")}</td>`}
      </tr>`;
    }).join("")}</tbody>
  </table></div>`;

export const standingsView = (state, ui) => {
  const st = standings(state);
  const mode = ui.standingsMode || "division";
  const tabs = `<div class="seg">${[["division", "Division"], ["conference", "Conference"], ["league", "League"]].map(([k, l]) => `<button data-standings="${k}" aria-pressed="${mode === k}">${l}</button>`).join("")}</div>`;
  let body;
  if (mode === "league") {
    body = `<section class="panel">${standingsTable(state, [...state.teams].sort((a, b) => points(b.record) - points(a.record) || b.record.row - a.record.row))}</section>`;
  } else if (mode === "conference") {
    body = Object.keys(st).map((conf) => `<section class="panel"><h2>${conf} Conference</h2><p class="note">The top ${RULES.playoffTeams / 2} make the playoffs.</p>${standingsTable(state, conferenceRanking(state, conf), { cutoff: RULES.playoffTeams / 2 })}</section>`).join("");
  } else {
    body = Object.entries(st).map(([conf, divs]) => `<h2 class="confhead">${conf} Conference</h2>${Object.entries(divs).map(([div, teams]) => `<section class="panel"><h3>${div} Division</h3>${standingsTable(state, teams)}</section>`).join("")}`).join("");
  }
  return `<div class="viewhead"><h1>Standings</h1>${tabs}</div><div class="stack">${body}</div>`;
};

// ---------- Roster ----------

const skaterCols = (s) => `<td class="num">${s.gp}</td><td class="num">${s.g}</td><td class="num">${s.a}</td><td class="num strong">${s.g + s.a}</td><td class="num">${signed(s.pm)}</td><td class="num">${s.pim}</td><td class="num">${s.sog}</td><td class="num">${s.hit}</td><td class="num">${s.blk}</td><td class="num">${s.gp ? toi(s.toi / s.gp) : "—"}</td>`;
const goalieCols = (s) => `<td class="num">${s.gp}</td><td class="num">${s.w}</td><td class="num">${s.l}</td><td class="num">${s.otl}</td><td class="num strong">${svp(s)}</td><td class="num">${gaa(s)}</td><td class="num">${s.so}</td>`;

export const rosterView = (state, ui, tid = state.userTid) => {
  const t = state.teams[tid];
  const mine = tid === state.userTid;
  const ps = roster(state, tid);
  const dressed = new Set([...t.lines.F.flat(), ...t.lines.D.flat(), ...t.lines.G]);
  const order = { C: 0, W: 1, D: 2, G: 3 };
  const sorted = ps.sort((a, b) => order[a.pos] - order[b.pos] || b.ovrs[b.pos] - a.ovrs[a.pos]);
  const skaters = sorted.filter((p) => p.pos !== "G");
  const goalies = sorted.filter((p) => p.pos === "G");
  const key = ui.statsKey || "stats";
  const statTabs = `<div class="seg">${[["stats", "Regular season"], ["playoffStats", "Playoffs"]].map(([k, l]) => `<button data-statskey="${k}" aria-pressed="${key === k}">${l}</button>`).join("")}</div>`;
  const row = (p, cols) => `<tr class="${dressed.has(p.pid) ? "" : "scratch"}">
      <td class="num muted">${p.jersey ?? ""}</td><td>${playerLink(p)}${p.legendary ? '<span class="tag">Legend</span>' : ""}</td><td>${typeChips(p.types)}</td>
      <td><span class="pos">${p.pos}</span></td><td class="num strong">${p.ovrs[p.pos]}</td><td class="num muted">${p.age}</td>${cols(p[key])}
      ${mine ? `<td><button class="btn small ghost" data-release="${p.pid}">Release</button></td>` : ""}
    </tr>`;
  return `
  <div class="viewhead"><h1>${mine ? "Your roster" : esc(teamName(t))}</h1>${statTabs}</div>
  <p class="note">${ps.length} of ${RULES.rosterMax} roster spots used. Team rating ${t.ovr}. Players not in the lines are greyed out as healthy scratches.${mine ? " A team needs at least " + RULES.minRoster + " players to play." : ""}</p>
  <section class="panel"><h2>Skaters</h2><div class="tablewrap"><table class="data">
    <thead><tr><th class="num">#</th><th>Player</th><th>Type</th><th>Pos</th><th class="num">OVR</th><th class="num">Age</th><th class="num">GP</th><th class="num">G</th><th class="num">A</th><th class="num">PTS</th><th class="num">+/−</th><th class="num">PIM</th><th class="num">SOG</th><th class="num">HIT</th><th class="num">BLK</th><th class="num">TOI</th>${mine ? "<th></th>" : ""}</tr></thead>
    <tbody>${skaters.map((p) => row(p, skaterCols)).join("")}</tbody></table></div></section>
  <section class="panel"><h2>Goalies</h2><div class="tablewrap"><table class="data">
    <thead><tr><th class="num">#</th><th>Player</th><th>Type</th><th>Pos</th><th class="num">OVR</th><th class="num">Age</th><th class="num">GP</th><th class="num">W</th><th class="num">L</th><th class="num">OTL</th><th class="num">SV%</th><th class="num">GAA</th><th class="num">SO</th>${mine ? "<th></th>" : ""}</tr></thead>
    <tbody>${goalies.map((p) => row(p, goalieCols)).join("")}</tbody></table></div></section>`;
};

// ---------- Lines ----------

export const linesView = (state) => {
  const t = state.teams[state.userTid];
  const ps = roster(state, t.tid);
  const byPid = state.players;
  const lo = lineupOvrs(t.lines, byPid);
  const slot = (group, i, j, pos, label) => {
    const pid = group === "G" ? t.lines.G[i] : t.lines[group][i][j];
    const options = [...ps].sort((a, b) => b.ovrs[pos] - a.ovrs[pos]);
    return `<label class="slot"><span class="slot-label">${label}</span>
      <select data-slot="${group}:${i}:${j ?? 0}" id="slot-${group}-${i}-${j ?? 0}">
        ${pid == null ? `<option value="" selected>Empty</option>` : ""}
        ${options.map((p) => `<option value="${p.pid}"${p.pid === pid ? " selected" : ""}>${esc(p.name)} · ${p.ovrs[pos]}${p.pos !== pos ? ` (${p.pos})` : ""}</option>`).join("")}
      </select>
      <span class="slot-ovr">${pid != null ? byPid[pid].ovrs[pos] : "—"}</span></label>`;
  };
  const dressed = new Set([...t.lines.F.flat(), ...t.lines.D.flat(), ...t.lines.G]);
  const scratches = ps.filter((p) => !dressed.has(p.pid));
  return `
  <div class="viewhead"><h1>Lines</h1><button class="btn" data-action="autolines">Auto-sort lines</button></div>
  <p class="note">Your top line plays the most minutes and also forms the power play. Picking a player who already has a spot swaps the two. Team rating: <b>${t.ovr}</b>.</p>
  <div class="grid lines">
    <section class="panel span2"><h2>Forwards</h2>
      ${t.lines.F.map((_, i) => `<div class="line"><div class="line-name">Line ${i + 1}<small>avg ${Math.round((lo.C[i] + lo.W[2 * i] + lo.W[2 * i + 1]) / 3)}</small></div>
        ${slot("F", i, 0, "C", "C")}${slot("F", i, 1, "W", "LW")}${slot("F", i, 2, "W", "RW")}</div>`).join("")}
    </section>
    <div class="stack">
    <section class="panel"><h2>Defense</h2>
      ${t.lines.D.map((_, i) => `<div class="line"><div class="line-name">Pair ${i + 1}<small>avg ${Math.round((lo.D[2 * i] + lo.D[2 * i + 1]) / 2)}</small></div>${slot("D", i, 0, "D", "LD")}${slot("D", i, 1, "D", "RD")}</div>`).join("")}
    </section>
    <section class="panel"><h2>Goalies</h2>
      <div class="line">${slot("G", 0, null, "G", "Starter")}${slot("G", 1, null, "G", "Backup")}</div>
      <p class="note">The backup starts about one game in six. Your starter plays every playoff game.</p>
      <h3>Healthy scratches</h3>
      ${scratches.length ? `<ul class="plain">${scratches.map((p) => `<li>${playerLink(p)} <span class="muted">${p.pos} · ${p.ovrs[p.pos]}</span></li>`).join("")}</ul>` : empty("Nobody. Everyone on the roster is dressed.")}
    </section>
    </div>
  </div>`;
};

// ---------- Schedule ----------

export const scheduleView = (state) => {
  const tid = state.userTid;
  const played = state.games.filter((g) => !g.playoffs && (g.home === tid || g.away === tid));
  const upcoming = state.phase === "regular" ? state.schedule.slice(state.day).flatMap((day, i) => day.filter((g) => g.home === tid || g.away === tid).map((g) => ({ ...g, day: state.day + i }))) : [];
  const po = state.games.filter((g) => g.playoffs && (g.home === tid || g.away === tid));
  return `
  <div class="viewhead"><h1>Schedule</h1></div>
  <div class="grid two">
    <section class="panel"><h2>Results</h2>${played.length || po.length ? `<div class="gamelist">${[...po].reverse().map((g) => gameLine(state, g, tid)).join("")}${[...played].reverse().map((g) => gameLine(state, g, tid)).join("")}</div>` : empty("No games yet.")}</section>
    <section class="panel"><h2>Coming up</h2>${upcoming.length ? `<ul class="plain upcoming">${upcoming.map((g) => {
      const opp = state.teams[g.home === tid ? g.away : g.home];
      return `<li><span class="muted">Day ${g.day + 1}</span> ${g.home === tid ? "vs" : "@"} ${teamLink(opp, true)}</li>`;
    }).join("")}</ul>` : empty(state.phase === "regular" ? "No games left." : "The regular season is complete.")}</section>
  </div>`;
};

// ---------- Box score ----------

export const gameView = (state, gid) => {
  const g = state.games[gid];
  if (!g) return empty("That game isn't in the records.");
  const teams = [state.teams[g.home], state.teams[g.away]];
  const P = (pid) => state.players[pid];
  const periods = g.periods.map((_, i) => periodName(i + 1, g.playoffs));
  const title = g.playoffs ? `${ROUND_NAMES[g.series.round]}, game ${g.series.game}` : `Day ${g.day + 1}`;
  const scoring = g.goals.map((x) => `<li><span class="muted">${periodName(x.period, g.playoffs)} ${clock(x.time)}</span> ${badge(teams[x.t])} <b>${playerLink(P(x.pid))}</b>${x.assists.length ? ` <span class="muted">from ${x.assists.map((a) => playerLink(P(a))).join(", ")}</span>` : " <span class=\"muted\">unassisted</span>"}${x.pp ? ' <span class="tag">PP</span>' : ""}${x.sh ? ' <span class="tag">SH</span>' : ""}${x.en ? ' <span class="tag">EN</span>' : ""}${x.gwg ? ' <span class="tag">GWG</span>' : ""}</li>`).join("");
  const skaterTable = (t) => {
    if (!g.lines) return "";
    const rows = Object.entries(g.lines).filter(([, l]) => l.t === t).map(([pid, l]) => [P(pid), l]).sort((a, b) => b[1].toi - a[1].toi);
    return `<h3>${esc(teamName(teams[t]))}</h3><div class="tablewrap"><table class="data"><thead><tr><th>Skater</th><th class="num">G</th><th class="num">A</th><th class="num">+/−</th><th class="num">SOG</th><th class="num">HIT</th><th class="num">BLK</th><th class="num">PIM</th><th class="num">TOI</th></tr></thead><tbody>
      ${rows.map(([p, l]) => `<tr><td>${playerLink(p)}</td><td class="num">${l.g}</td><td class="num">${l.a}</td><td class="num">${signed(l.pm)}</td><td class="num">${l.sog}</td><td class="num">${l.hit}</td><td class="num">${l.blk}</td><td class="num">${l.pim}</td><td class="num">${toi(l.toi)}</td></tr>`).join("")}
    </tbody></table></div>`;
  };
  return `
  <div class="viewhead"><h1>Box score</h1><span class="note">${state.season} · ${esc(title)}</span></div>
  <section class="panel boxhead">
    ${[1, 0].map((t) => `<div class="boxteam${g.score[t] > g.score[1 - t] ? " won" : ""}">${teamLink(teams[t], true)}<b>${g.score[t]}</b></div>`).join("")}
    <div class="note">${g.so ? "Final, shootout" : g.ot ? "Final, overtime" : "Final"}</div>
  </section>
  <div class="grid two">
    <section class="panel"><h2>By period</h2><div class="tablewrap"><table class="data">
      <thead><tr><th>Team</th>${periods.map((p) => `<th class="num">${p}</th>`).join("")}${g.so ? '<th class="num">SO</th>' : ""}<th class="num">T</th><th class="num">SOG</th></tr></thead>
      <tbody>${[1, 0].map((t) => `<tr><td>${badge(teams[t])}</td>${g.periods.map((p) => `<td class="num">${p[t]}</td>`).join("")}${g.so ? `<td class="num">${g.so.made[t]}</td>` : ""}<td class="num strong">${g.score[t]}</td><td class="num">${g.shots[t]}</td></tr>`).join("")}</tbody>
    </table></div>
    <h2 class="gap">Goalies</h2><div class="tablewrap"><table class="data"><thead><tr><th>Goalie</th><th class="num">SA</th><th class="num">GA</th><th class="num">SV%</th><th>Dec</th></tr></thead><tbody>
      ${[1, 0].map((t) => { const gl = g.goalies[t]; const p = P(gl.pid); return `<tr><td>${badge(teams[t])} ${p ? playerLink(p) : "—"}</td><td class="num">${gl.sa}</td><td class="num">${gl.ga}</td><td class="num">${svp(gl)}</td><td>${gl.dec}</td></tr>`; }).join("")}
    </tbody></table></div></section>
    <section class="panel"><h2>Scoring</h2>${scoring ? `<ul class="plain scoring">${scoring}</ul>` : empty("No goals.")}
      ${g.penalties.length ? `<h3>Penalties</h3><ul class="plain">${g.penalties.map((x) => `<li><span class="muted">${periodName(x.period, g.playoffs)} ${clock(x.time)}</span> ${badge(teams[x.t])} ${playerLink(P(x.pid))} <span class="muted">2 min</span></li>`).join("")}</ul>` : ""}
    </section>
  </div>
  ${g.lines ? `<section class="panel"><h2>Skaters</h2>${skaterTable(1)}${skaterTable(0)}</section>` : `<p class="note">Full skater lines are kept for your own team's games.</p>`}`;
};

// ---------- Playoffs ----------

export const playoffsView = (state) => {
  if (!state.playoffs) {
    const confs = Object.keys(standings(state));
    return `<div class="viewhead"><h1>Playoffs</h1></div>
      <p class="note">The top ${RULES.playoffTeams / 2} teams in each conference make it. Every round is best of ${RULES.playoffSeriesLength}. If the season ended today:</p>
      <div class="grid two">${confs.map((conf) => `<section class="panel"><h2>${conf} Conference</h2><ol class="seeds">${conferenceRanking(state, conf).slice(0, RULES.playoffTeams / 2).map((t) => `<li class="${t.tid === state.userTid ? "mine" : ""}">${teamLink(t, true)} <span class="muted">${points(t.record)} pts</span></li>`).join("")}</ol></section>`).join("")}</div>`;
  }
  const series = (s) => {
    const row = (tid, wins, seed) => {
      const t = state.teams[tid];
      return `<div class="sr${s.winner === tid ? " won" : ""}${tid === state.userTid ? " mine" : ""}"><span class="seed">${seed ?? ""}</span>${badge(t)}<span class="sr-name">${esc(t.city)}</span><b>${wins}</b></div>`;
    };
    return `<button class="series" data-series="${s.games[s.games.length - 1] ?? ""}" ${s.games.length ? "" : "disabled"}>${row(s.home, s.wins[0], s.seeds?.[0])}${row(s.away, s.wins[1], s.seeds?.[1])}</button>`;
  };
  const rounds = state.playoffs.rounds;
  return `<div class="viewhead"><h1>Playoffs</h1>${state.champion != null ? `<span class="note">Champion: <b>${esc(teamName(state.teams[state.champion]))}</b></span>` : ""}</div>
  <div class="bracket-wrap"><div class="bracket">
    ${ROUND_NAMES.map((name, r) => `<div class="round"><h3>${name}</h3>${(rounds[r] ?? []).map(series).join("") || `<p class="empty">Not started</p>`}</div>`).join("")}
  </div></div>`;
};

// ---------- Leaders ----------

export const leadersView = (state, ui) => {
  const key = ui.statsKey || "stats";
  const ps = state.players.filter((p) => p.tid >= 0 && p[key].gp);
  const top = (list, val, n = 10) =>
    list.map((p) => [p, val(p[key])]).sort((a, b) => b[1] - a[1]).slice(0, n);
  const low = (list, val, n = 10) => list.map((p) => [p, val(p[key])]).sort((a, b) => a[1] - b[1]).slice(0, n);
  const skaters = ps.filter((p) => p.pos !== "G");
  const minGp = key === "stats" ? Math.max(1, Math.floor(state.day / 6)) : 1;
  const goalies = ps.filter((p) => p.pos === "G" && p[key].gs >= minGp);
  const board = (title, rows, fmt = (x) => x) => `<section class="panel"><h2>${title}</h2>${rows.length ? `<ol class="leaders">${rows.map(([p, v]) => `<li>${badge(state.teams[p.tid])} ${playerLink(p)}<b>${fmt(v)}</b></li>`).join("")}</ol>` : empty("No games yet.")}</section>`;
  const statTabs = `<div class="seg">${[["stats", "Regular season"], ["playoffStats", "Playoffs"]].map(([k, l]) => `<button data-statskey="${k}" aria-pressed="${key === k}">${l}</button>`).join("")}</div>`;
  return `<div class="viewhead"><h1>League leaders</h1>${statTabs}</div>
  <div class="grid three">
    ${board("Points", top(skaters, (s) => s.g + s.a))}
    ${board("Goals", top(skaters, (s) => s.g))}
    ${board("Assists", top(skaters, (s) => s.a))}
    ${board("Plus/minus", top(skaters, (s) => s.pm), signed)}
    ${board("Hits", top(skaters, (s) => s.hit))}
    ${board("Blocked shots", top(skaters, (s) => s.blk))}
    ${board("Goalie wins", top(goalies, (s) => s.w))}
    ${board("Save percentage", top(goalies, (s) => (s.sa ? 1 - s.ga / s.sa : 0)), (v) => v.toFixed(3).replace(/^0/, ""))}
    ${board("Goals against average", low(goalies, (s) => (s.toi ? (s.ga * 3600) / s.toi : 99)), (v) => v.toFixed(2))}
  </div>`;
};

// ---------- Free agents ----------

export const freeAgentsView = (state, ui) => {
  const mine = roster(state, state.userTid);
  const full = mine.length >= RULES.rosterMax;
  const legendsFull = mine.filter((p) => p.legendary).length >= RULES.maxLegendariesPerTeam;
  const pos = ui.faPos || "all";
  const q = (ui.faQuery || "").trim().toLowerCase();
  const list = state.players
    .filter((p) => p.tid === -1 && (pos === "all" || p.natural === pos) && (!q || p.name.toLowerCase().includes(q)))
    .sort((a, b) => b.ovrs[b.natural] - a.ovrs[a.natural])
    .slice(0, 120);
  return `
  <div class="viewhead"><h1>Free agents</h1>
    <div class="row">
      <input type="search" id="fa-q" placeholder="Search Pokémon" value="${esc(ui.faQuery || "")}" aria-label="Search free agents">
      <div class="seg">${[["all", "All"], ["C", "C"], ["W", "W"], ["D", "D"], ["G", "G"]].map(([k, l]) => `<button data-fapos="${k}" aria-pressed="${pos === k}">${l}</button>`).join("")}</div>
    </div>
  </div>
  <p class="note">Every Pokémon not drafted is available. You have ${mine.length} of ${RULES.rosterMax} spots filled${full ? ", so release someone on the Roster screen before signing" : ""}. Teams may carry ${RULES.maxLegendariesPerTeam} Legendary.</p>
  <section class="panel"><div class="tablewrap"><table class="data">
    <thead><tr><th>Player</th><th>Type</th><th>Fit</th><th class="num">C</th><th class="num">W</th><th class="num">D</th><th class="num">G</th><th class="num">Age</th><th></th></tr></thead>
    <tbody>${list.map((p) => `<tr><td>${playerLink(p)}${p.legendary ? '<span class="tag">Legend</span>' : ""}</td><td>${typeChips(p.types)}</td><td><span class="pos">${p.natural}</span></td>
      ${["C", "W", "D", "G"].map((x) => `<td class="num${x === p.natural ? " strong" : ""}">${p.ovrs[x]}</td>`).join("")}<td class="num muted">${p.age}</td>
      <td><button class="btn small" data-sign="${p.pid}" ${full || (p.legendary && legendsFull) ? "disabled" : ""}${p.legendary && legendsFull ? ' title="You already have a Legendary"' : ""}>Sign</button></td></tr>`).join("")}</tbody>
  </table></div></section>`;
};

// ---------- Player card ----------

export const playerCard = (state, pid) => {
  const p = state.players[pid];
  const t = p.tid >= 0 ? state.teams[p.tid] : null;
  const pos = p.pos ?? p.natural;
  const s = p.stats;
  const ps = p.playoffStats;
  const statBlock = (label, x) => (pos === "G"
    ? `<tr><td>${label}</td><td class="num">${x.gp}</td><td class="num">${x.w}-${x.l}-${x.otl}</td><td class="num">${svp(x)}</td><td class="num">${gaa(x)}</td><td class="num">${x.so}</td></tr>`
    : `<tr><td>${label}</td><td class="num">${x.gp}</td><td class="num">${x.g}</td><td class="num">${x.a}</td><td class="num">${x.g + x.a}</td><td class="num">${signed(x.pm)}</td></tr>`);
  return `
  <div class="card-head" style="--tc:${TYPE_COLORS[p.types[0]]}">
    <div class="eyebrow">#${p.num} · ${t ? esc(teamName(t)) : "Free agent"}${p.jersey != null ? ` · No. ${p.jersey}` : ""}</div>
    <div class="big">${esc(p.name)}</div>
    <div>${typeChips(p.types)} <span class="note">${POS_NAMES[pos]} · age ${p.age}${p.legendary ? " · Legendary" : ""}</span></div>
  </div>
  <div class="ovrs">${["C", "W", "D", "G"].map((x) => `<div class="ovr${x === pos ? " best" : ""}"><b>${p.ovrs[x]}</b><span>${POS_NAMES[x].toUpperCase()}</span></div>`).join("")}</div>
  <div class="bars">${Object.entries(SKILLS).map(([k, label]) => `<div class="barrow"><span>${label}</span><span class="track"><span class="fill" style="width:${p.skills[k]}%"></span></span><span class="v">${p.skills[k]}</span></div>`).join("")}</div>
  <div class="tablewrap"><table class="data">
    <thead><tr><th></th>${pos === "G" ? '<th class="num">GP</th><th class="num">W-L-OT</th><th class="num">SV%</th><th class="num">GAA</th><th class="num">SO</th>' : '<th class="num">GP</th><th class="num">G</th><th class="num">A</th><th class="num">PTS</th><th class="num">+/−</th>'}</tr></thead>
    <tbody>${statBlock("Season", s)}${ps.gp ? statBlock("Playoffs", ps) : ""}</tbody>
  </table></div>
  <div class="row">
    ${p.tid === state.userTid ? `<button class="btn ghost" data-release="${p.pid}">Release</button>` : ""}
    ${p.tid === -1 ? `<button class="btn primary" data-sign="${p.pid}">Sign</button>` : ""}
    <button class="btn" data-action="close">Close</button>
  </div>`;
};
