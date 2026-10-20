// The game's browser controller: holds the league, routes between screens,
// runs the play buttons and saves after every change.

import { DEX as dex } from "../dex.js";
import { createLeague, autoLines, teamOvr } from "../league.js";
import { randomSeed } from "../random.js";
import { migrateSave } from "../save.js";
import { stateHash } from "../hash.js";
import { playDay, canPlay, releasePlayer, signPlayer, userGameToday } from "../season.js";
import { saveLeague, loadLeague, deleteLeague } from "./storage.js";
import { startNextSeason } from "../offseason.js";
import { chooseEvolution } from "../growth.js";
import * as V from "./views.js";

const app = document.getElementById("app");
const dialog = document.getElementById("player-dialog");
const dialogBody = document.getElementById("player-body");
const confirmBox = document.getElementById("confirm");

let state = null;
let draft = null; // a freshly drafted league waiting for the user to pick a team
const ui = { view: "home", busy: false, notice: "", stop: false };

const render = () => {
  if (!state) {
    app.innerHTML = V.newLeagueView(draft);
    return;
  }
  let body;
  switch (ui.view) {
    case "standings":
      body = V.standingsView(state, ui);
      break;
    case "roster":
      body = V.rosterView(state, ui);
      break;
    case "team":
      body = V.rosterView(state, ui, ui.tid);
      break;
    case "lines":
      body = V.linesView(state, ui);
      break;
    case "schedule":
      body = V.scheduleView(state, ui);
      break;
    case "game":
      body = V.gameView(state, ui.gid);
      break;
    case "playoffs":
      body = V.playoffsView(state, ui);
      break;
    case "leaders":
      body = V.leadersView(state, ui);
      break;
    case "history":
      body = V.historyView(state, ui);
      break;
    case "free":
      body = V.freeAgentsView(state, ui);
      break;
    default:
      body = V.homeView(state, ui);
  }
  app.innerHTML = `<header class="top">${V.header(state, ui)}</header><main class="view" data-view="${ui.view}">${body}</main>
    <footer class="foot"><span>Pokémon NHL · step 3 · a fan project</span><button class="link" data-action="new">Start a new league</button></footer>`;
};

const persist = () => saveLeague(state);

const go = (view, extra = {}) => {
  Object.assign(ui, { view, notice: "" }, extra);
  render();
  window.scrollTo?.(0, 0);
};

const showPlayer = (pid) => {
  dialogBody.innerHTML = V.playerCard(state ?? draft, pid);
  if (!dialog.open) dialog.showModal();
};

const askConfirm = (text, yesLabel) =>
  new Promise((resolve) => {
    confirmBox.querySelector("p").textContent = text;
    confirmBox.querySelector("[data-yes]").textContent = yesLabel;
    confirmBox.onclose = () => resolve(confirmBox.returnValue === "yes");
    confirmBox.showModal();
  });

// ---------- Playing ----------

const stopWhen = {
  day: (s, start) => s.day > start.day || s.phase !== start.phase || (s.playoffs?.day ?? 0) > (start.poDay ?? 0),
  week: (s, start) => s.phase !== "regular" || s.day >= start.day + 7,
  month: (s, start) => s.phase !== "regular" || s.day >= start.day + 30,
  regular: (s) => s.phase !== "regular",
  round: (s, start) => s.phase !== "playoffs" || s.playoffs.rounds.length > start.rounds,
  playoffs: (s) => s.phase === "done",
};

const play = async (kind) => {
  const ok = canPlay(state);
  if (!ok.ok) {
    ui.notice = ok.why;
    render();
    return;
  }
  const start = {
    day: state.day,
    phase: state.phase,
    poDay: state.playoffs?.day,
    rounds: state.playoffs?.rounds.length ?? 0,
  };
  ui.busy = true;
  ui.stop = false;
  ui.notice = "";
  render();
  while (!ui.stop && state.phase !== "done") {
    playDay(state);
    ui.busyText = state.phase === "regular" ? `Day ${state.day} of ${state.schedule.length}` : "Playoffs";
    if (stopWhen[kind](state, start)) break;
    if (state.phase === "regular" && state.day % 3 === 0) {
      render();
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  ui.busy = false;
  await persist();
  render();
};

// ---------- Events ----------

app.addEventListener("click", async (e) => {
  const el = e.target.closest("button");
  if (!el || el.disabled) return;
  const d = el.dataset;

  if (d.pick != null && draft) {
    draft.userTid = Number(d.pick);
    state = draft;
    draft = null;
    await persist();
    go("home");
    return;
  }
  if (d.action === "redraft") {
    draft = createLeague({ dex, seed: randomSeed() });
    render();
    return;
  }
  if (!state) return;

  if (d.play) return play(d.play);
  if (d.action === "stop") {
    ui.stop = true;
    return;
  }
  if (d.action === "next-season") {
    startNextSeason(state);
    ui.notice = `The ${state.season} season is ready. Rosters carried over and everyone is a year older.`;
    await persist();
    return go("home", { notice: ui.notice });
  }
  if (d.action === "new") {
    if (await askConfirm("Start a new league? Your current league will be deleted.", "Delete and start over")) {
      await deleteLeague();
      state = null;
      draft = createLeague({ dex, seed: randomSeed() });
      ui.view = "home";
      render();
    }
    return;
  }
  if (d.go) return go(d.go, d.tid != null ? { tid: Number(d.tid) } : {});
  if (d.game != null) return go("game", { gid: Number(d.game) });
  if (d.series) return go("game", { gid: Number(d.series) });
  if (d.player != null) return showPlayer(Number(d.player));
  if (d.standings) {
    ui.standingsMode = d.standings;
    return render();
  }
  if (d.statskey) {
    ui.statsKey = d.statskey;
    return render();
  }
  if (d.retired) {
    ui.retiredSeason = d.retired;
    return render();
  }
  if (d.fapos) {
    ui.faPos = d.fapos;
    return render();
  }
  if (d.action === "autolines") {
    const t = state.teams[state.userTid];
    t.lines = autoLines(state.players.filter((p) => p.tid === t.tid));
    t.ovr = teamOvr(t, state.players);
    ui.notice = "Lines sorted by rating.";
    await persist();
    return render();
  }
  if (d.release != null) return release(Number(d.release));
  if (d.sign != null) return sign(Number(d.sign));
  if (d.evolve != null) return evolvePlayer(d.evolve);
});

const release = async (pid) => {
  const p = state.players[pid];
  if (!(await askConfirm(`Release ${p.name}? They become a free agent anyone can sign.`, "Release"))) return;
  releasePlayer(state, pid);
  ui.notice = `${p.name} was released.`;
  if (dialog.open) dialog.close();
  await persist();
  render();
};

const sign = async (pid) => {
  const res = signPlayer(state, pid);
  ui.notice = res.ok ? `${state.players[pid].name} signed. They took the best open spot in your lines.` : res.why;
  if (dialog.open) dialog.close();
  await persist();
  render();
};

// Lines: choosing a player for a slot swaps them with wherever they were.
app.addEventListener("change", async (e) => {
  const sel = e.target.closest("select[data-slot]");
  if (!sel || !state) return;
  const [group, i, j] = sel.dataset.slot.split(":");
  const pid = sel.value === "" ? null : Number(sel.value);
  const t = state.teams[state.userTid];
  const L = t.lines;
  const get = (g, a, b) => (g === "G" ? L.G[a] : L[g][a][b]);
  const set = (g, a, b, v) => {
    if (g === "G") L.G[a] = v;
    else L[g][a][b] = v;
  };
  const prev = get(group, +i, +j);
  // Find where the chosen player currently plays, if anywhere, and swap.
  for (const g of ["F", "D", "G"]) {
    const rows = g === "G" ? [L.G] : L[g];
    rows.forEach((row, a) =>
      row.forEach((x, b) => {
        if (x === pid && pid != null) {
          if (g === "G") L.G[b] = prev;
          else L[g][a][b] = prev;
        }
      }),
    );
  }
  set(group, +i, +j, pid);
  t.ovr = teamOvr(t, state.players);
  await persist();
  render();
});

app.addEventListener("input", (e) => {
  if (e.target.id === "fa-q") {
    ui.faQuery = e.target.value;
    const pos = e.target.selectionStart;
    render();
    const el = document.getElementById("fa-q");
    el.focus();
    el.setSelectionRange(pos, pos);
  }
});

dialog.addEventListener("click", (e) => {
  const el = e.target.closest("button");
  if (e.target === dialog || el?.dataset.action === "close") return dialog.close();
  if (el?.dataset.release != null) return release(Number(el.dataset.release));
  if (el?.dataset.sign != null) return sign(Number(el.dataset.sign));
  if (el?.dataset.player != null) return showPlayer(Number(el.dataset.player));
  if (el?.dataset.evolve != null) return evolvePlayer(el.dataset.evolve);
});

const evolvePlayer = async (choice) => {
  const [pid, id] = choice.split(":");
  const p = state.players[Number(pid)];
  const from = p.name;
  chooseEvolution(state, p.pid, id);
  ui.notice = `${from} evolved into ${p.name}!`;
  await persist();
  showPlayer(p.pid);
  render();
};

// ---------- Boot ----------

// A new league uses ?seed=123 from the address when given, so a league can be
// replayed exactly. Otherwise the seed is random.
const firstSeed = () => {
  const seed = Number(new URLSearchParams(location.search).get("seed"));
  return Number.isInteger(seed) && seed > 0 ? seed : randomSeed();
};

const boot = async () => {
  state = migrateSave(await loadLeague(), dex);
  if (!state) draft = createLeague({ dex, seed: firstSeed() });
  render();
};

// Exposed for the browser tests.
window.pokemonNhl = {
  get state() {
    return state;
  },
  hash: () => state && stateHash(state),
  userGameToday: () => state && userGameToday(state),
};

boot();
