// Game simulation. A game is played in 10-second ticks. Each tick the team with
// the puck either shoots, loses it, or keeps cycling, with the odds tilted by the
// skills of the five skaters on the ice. Lines change on a shift clock.

const TICK = 10;
const PERIOD_TICKS = 1200 / TICK;
const PENALTY_TICKS = 120 / TICK;
const FWD_SHARE = [0.36, 0.3, 0.21, 0.13];
const D_SHARE = [0.4, 0.34, 0.26];

const offense = (p) => 0.3 * p.skills.oiq + 0.25 * p.skills.pss + 0.25 * p.skills.stk + 0.2 * p.skills.spd;
const defense = (p) => 0.35 * p.skills.diq + 0.25 * p.skills.chk + 0.2 * p.skills.blk + 0.2 * p.skills.spd;
const shooting = (p, isD) => (isD ? 0.4 * p.skills.wst + 0.6 * p.skills.sst : 0.6 * p.skills.wst + 0.4 * p.skills.sst);
const goalieRating = (g) => (g ? g.ovrs.G : 20);
const shootoutSkill = (p) => (p.skills.stk + p.skills.wst) / 2;

// The league-wide averages the odds below were tuned around. A game measures
// players against the league's current averages and shifts them onto these,
// so when the whole league grows (levels, evolution) scoring stays the same
// and only being better than your peers helps.
export const BASELINE = { off: 44.5, def: 44.75, blk: 42.5, shoot: 47.5, G: 49.5, so: 46.75 };

export const leagueNorm = (teams, byPid) => {
  const sums = { off: 0, def: 0, blk: 0, shoot: 0, so: 0, n: 0, G: 0, ng: 0 };
  for (const t of teams) {
    const F = t.lines.F.flat();
    const D = t.lines.D.flat();
    for (const [pids, isD] of [
      [F, false],
      [D, true],
    ]) {
      for (const pid of pids) {
        const p = pid == null ? null : byPid[pid];
        if (!p) continue;
        sums.off += offense(p);
        sums.def += defense(p);
        sums.blk += p.skills.blk;
        sums.shoot += shooting(p, isD);
        sums.so += shootoutSkill(p);
        sums.n++;
      }
    }
    const g = t.lines.G[0] == null ? null : byPid[t.lines.G[0]];
    if (g) {
      sums.G += g.ovrs.G;
      sums.ng++;
    }
  }
  if (!sums.n || !sums.ng) return BASELINE;
  return {
    off: sums.off / sums.n,
    def: sums.def / sums.n,
    blk: sums.blk / sums.n,
    shoot: sums.shoot / sums.n,
    so: sums.so / sums.n,
    G: sums.G / sums.ng,
  };
};

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);

// Pick the line that is furthest behind its share of ice time.
const nextLine = (played, share) => {
  const total = played.reduce((a, b) => a + b, 0) + 1;
  let best = 0;
  let bestGap = -Infinity;
  share.forEach((s, i) => {
    const gap = s * total - played[i];
    if (gap > bestGap) {
      bestGap = gap;
      best = i;
    }
  });
  return best;
};

const makeSide = (team, byPid, rng, { playoffs }) => {
  const get = (pid) => (pid == null ? null : byPid[pid]);
  const F = team.lines.F.map((line) => line.map(get).filter(Boolean));
  const D = team.lines.D.map((pair) => pair.map(get).filter(Boolean));
  const starterIdx = !playoffs && team.lines.G[1] != null && rng.chance(0.18) ? 1 : 0;
  const goalie = get(team.lines.G[starterIdx]) ?? get(team.lines.G[0]);
  return {
    team,
    F,
    D,
    goalie,
    fLine: 0,
    dPair: 0,
    fPlayed: [0, 0, 0, 0],
    dPlayed: [0, 0, 0],
    fShift: 0,
    dShift: 0,
    box: [], // ticks left on each penalty being served
    pulled: false,
  };
};

const skatersOnIce = (side, count) => {
  const fwd = side.F[side.fLine] ?? side.F[0];
  const def = side.D[side.dPair] ?? side.D[0];
  if (count >= 5) return [...fwd, ...def];
  if (count === 4) return [...fwd.slice(0, 2), ...def];
  return [...fwd.slice(0, 2), ...def.slice(0, 1)];
};

export const simGame = ({ home, away, byPid, rng, playoffs = false, norm = BASELINE }) => {
  // How far the league has moved from the baseline, for each measure.
  const shift = Object.fromEntries(Object.keys(BASELINE).map((k) => [k, BASELINE[k] - norm[k]]));
  const sides = [makeSide(home, byPid, rng, { playoffs }), makeSide(away, byPid, rng, { playoffs })];
  const score = [0, 0];
  const shots = [0, 0];
  const periodScores = [];
  const goals = [];
  const penalties = [];
  const lines = {}; // pid -> stat line for this game

  const line = (p, t) => (lines[p.pid] ??= { t, g: 0, a: 0, pm: 0, pim: 0, sog: 0, hit: 0, blk: 0, toi: 0, ppg: 0 });
  for (const [t, side] of sides.entries()) {
    for (const p of [...side.F.flat(), ...side.D.flat()]) line(p, t);
  }
  const goalieLines = sides.map((s) => ({ pid: s.goalie?.pid, sa: 0, ga: 0, toi: 0 }));

  let poss = 0;
  let period = 0;
  let tickInPeriod = 0;
  let needFaceoff = true;
  let overtime = false;
  let shootout = null;

  const strength = (t) => {
    const n = 5 - Math.min(2, sides[t].box.length);
    return sides[t].pulled ? n + 1 : n;
  };

  const faceoff = (onIce) => {
    const c0 = onIce[0][0];
    const c1 = onIce[1][0];
    const f0 = c0 ? c0.skills.fcf : 50;
    const f1 = c1 ? c1.skills.fcf : 50;
    poss = rng.chance(0.5 + (f0 - f1) / 200) ? 0 : 1;
  };

  const changeLines = (side) => {
    if (--side.fShift <= 0) {
      side.fLine = nextLine(side.fPlayed, FWD_SHARE.slice(0, side.F.length));
      side.fShift = rng.int(4, 5);
    }
    if (--side.dShift <= 0) {
      side.dPair = nextLine(side.dPlayed, D_SHARE.slice(0, side.D.length));
      side.dShift = rng.int(5, 6);
    }
  };

  const playTick = (ot3v3) => {
    for (const side of sides) changeLines(side);
    const counts = ot3v3 ? [3, 3] : [strength(0), strength(1)];
    // On a power play the top unit goes out.
    const onIce = sides.map((side, t) => {
      const oppShort = counts[1 - t] < counts[t] && !ot3v3;
      if (oppShort) return skatersOnIce({ ...side, fLine: 0, dPair: 0 }, Math.min(5, counts[t]));
      return skatersOnIce(side, Math.min(5, counts[t]));
    });
    for (const [t, side] of sides.entries()) {
      side.fPlayed[side.fLine] += 1;
      side.dPlayed[side.dPair] += 1;
      for (const p of onIce[t]) line(p, t).toi += TICK;
    }
    if (needFaceoff) {
      faceoff(onIce);
      needFaceoff = false;
    }

    // Penalties
    for (const t of [0, 1]) {
      if (!ot3v3 && sides[t].box.length < 2 && rng.chance(0.0085)) {
        const skaters = onIce[t];
        const idx = rng.weighted(skaters.map((p) => p.skills.chk + p.skills.stre));
        const p = skaters[idx];
        line(p, t).pim += 2;
        sides[t].box.push(PENALTY_TICKS);
        penalties.push({ t, pid: p.pid, period: period + 1, time: tickInPeriod * TICK });
      }
    }

    const A = poss;
    const B = 1 - A;
    const offA = mean(onIce[A].map(offense)) + shift.off;
    const defB = mean(onIce[B].map(defense)) + shift.def;
    const manAdv = counts[A] - counts[B];
    let d = (offA - defB) / 22 + 0.45 * manAdv + (A === 0 ? 0.04 : -0.04);
    if (ot3v3) d += 0.2;
    const pShot = Math.min(0.6, 0.27 * Math.exp(0.5 * d));
    const pTurn = Math.min(0.6, 0.28 * Math.exp(-0.5 * d));
    const r = rng.next();

    if (r < pShot) {
      const skaters = onIce[A];
      const isD = (p) => sides[A].D.flat().includes(p);
      const shooter =
        skaters[rng.weighted(skaters.map((p) => (p.skills.oiq + p.skills.wst + p.skills.sst) * (isD(p) ? 0.55 : 1)))];
      const blockers = onIce[B];
      const blockChance = 0.22 * ((mean(blockers.map((p) => p.skills.blk)) + shift.blk) / 45);
      if (rng.chance(blockChance)) {
        const blocker = blockers[rng.weighted(blockers.map((p) => p.skills.blk))];
        line(blocker, B).blk++;
        poss = rng.chance(0.5) ? A : B;
        return;
      }
      if (rng.chance(0.22)) {
        poss = rng.chance(0.45) ? A : B;
        return;
      }
      shots[A]++;
      line(shooter, A).sog++;
      const goalie = sides[B].pulled ? null : sides[B].goalie;
      let goalChance;
      if (!goalie) {
        goalChance = 0.6;
      } else {
        goalieLines[B].sa++;
        const sv =
          0.919 +
          0.0015 * (goalieRating(goalie) + shift.G - 50) -
          0.0012 * (shooting(shooter, isD(shooter)) + shift.shoot - 48) -
          0.012 * Math.max(0, manAdv);
        goalChance = 1 - Math.max(0.86, Math.min(0.95, sv));
      }
      if (rng.chance(goalChance)) {
        score[A]++;
        if (goalie) goalieLines[B].ga++;
        const s = line(shooter, A);
        s.g++;
        const pp = manAdv > 0 && !ot3v3;
        if (pp) s.ppg++;
        const mates = skaters.filter((p) => p !== shooter);
        const assists = [];
        for (const chance of [0.9, 0.7]) {
          if (!mates.length || !rng.chance(chance)) break;
          const i = rng.weighted(mates.map((p) => p.skills.pss + p.skills.oiq));
          assists.push(mates[i].pid);
          line(mates[i], A).a++;
          mates.splice(i, 1);
        }
        if (!pp) {
          for (const p of onIce[A]) line(p, A).pm++;
          for (const p of onIce[B]) line(p, B).pm--;
        }
        if (pp) sides[B].box.shift();
        goals.push({
          t: A,
          period: period + 1,
          time: tickInPeriod * TICK,
          pid: shooter.pid,
          assists,
          pp,
          sh: manAdv < 0,
          en: !goalie,
          score: [...score],
        });
        needFaceoff = true;
        return;
      }
      if (goalie && rng.chance(0.45)) {
        needFaceoff = true; // goalie freezes it
        return;
      }
      poss = rng.chance(0.3) ? A : B;
      return;
    }
    if (r < pShot + pTurn) {
      if (rng.chance(0.4)) {
        const hitter = onIce[B][rng.weighted(onIce[B].map((p) => p.skills.chk + p.skills.stre))];
        line(hitter, B).hit++;
      }
      poss = B;
    }
  };

  const advanceClock = () => {
    tickInPeriod++;
    for (const side of sides) side.box = side.box.map((x) => x - 1).filter((x) => x > 0);
  };

  // Regulation
  for (period = 0; period < 3; period++) {
    const before = [...score];
    tickInPeriod = 0;
    needFaceoff = true;
    for (let i = 0; i < PERIOD_TICKS; i++) {
      // Pull the goalie late when down by one or two.
      if (period === 2 && PERIOD_TICKS - i <= 9) {
        const diff = score[0] - score[1];
        sides[0].pulled = diff < 0 && diff >= -2;
        sides[1].pulled = diff > 0 && diff <= 2;
      }
      playTick(false);
      advanceClock();
    }
    sides[0].pulled = sides[1].pulled = false;
    periodScores.push([score[0] - before[0], score[1] - before[1]]);
  }
  let regTicks = 3 * PERIOD_TICKS;

  // Overtime
  if (score[0] === score[1]) {
    overtime = true;
    for (const side of sides) side.box = [];
    if (playoffs) {
      while (score[0] === score[1]) {
        const before = [...score];
        tickInPeriod = 0;
        needFaceoff = true;
        for (let i = 0; i < PERIOD_TICKS && score[0] === score[1]; i++) {
          playTick(false);
          advanceClock();
          regTicks++;
        }
        periodScores.push([score[0] - before[0], score[1] - before[1]]);
        period++;
      }
    } else {
      const before = [...score];
      tickInPeriod = 0;
      needFaceoff = true;
      for (let i = 0; i < 30 && score[0] === score[1]; i++) {
        playTick(true);
        advanceClock();
        regTicks++;
      }
      periodScores.push([score[0] - before[0], score[1] - before[1]]);
      period++;
      if (score[0] === score[1]) shootout = runShootout(sides, rng, score, shift);
    }
  }

  for (const g of goalieLines) g.toi = regTicks * TICK;
  const winner = score[0] > score[1] ? 0 : 1;
  // Game-winning goal: the one that put the winner one ahead of the loser's final total.
  if (!shootout) {
    const loserFinal = score[1 - winner];
    const gwg = goals.find((g) => g.t === winner && g.score[winner] === loserFinal + 1);
    if (gwg) gwg.gwg = true;
  }

  return {
    home: home.tid,
    away: away.tid,
    score,
    shots,
    periods: periodScores,
    ot: overtime,
    so: shootout,
    goals,
    penalties,
    lines,
    goalies: goalieLines.map((g, t) => ({ ...g, dec: t === winner ? "W" : overtime && !playoffs ? "OTL" : "L" })),
    playoffs,
  };
};

const runShootout = (sides, rng, score, shift) => {
  const shooters = sides.map((s) =>
    [...s.F.flat(), ...s.D.flat()].sort((a, b) => b.skills.stk + b.skills.wst - (a.skills.stk + a.skills.wst)),
  );
  const made = [0, 0];
  const attempts = [];
  for (let round = 0; round < 20; round++) {
    for (const t of [0, 1]) {
      const shooter = shooters[t][round % shooters[t].length];
      const goalie = sides[1 - t].goalie;
      const p = 0.33 + (shootoutSkill(shooter) + shift.so - (goalieRating(goalie) + shift.G)) / 300;
      const scored = rng.chance(Math.max(0.15, Math.min(0.55, p)));
      if (scored) made[t]++;
      attempts.push({ t, pid: shooter.pid, scored });
    }
    if (round >= 2 && made[0] !== made[1]) break;
    if (round < 2) {
      const left = 2 - round;
      if (made[0] > made[1] + left || made[1] > made[0] + left) break;
    }
  }
  if (made[0] === made[1]) made[rng.chance(0.5) ? 0 : 1]++;
  score[made[0] > made[1] ? 0 : 1]++;
  return { made, attempts };
};
