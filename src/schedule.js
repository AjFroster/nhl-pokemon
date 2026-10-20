// An 82-game schedule with the NHL's shape: 26 games in the division, 24 against
// the rest of the conference and 32 against the other conference.

const addGames = (games, a, b, n, rng) => {
  // Split home and away as evenly as possible; a coin decides the odd game.
  const aHome = Math.floor(n / 2) + (n % 2 && rng.chance(0.5) ? 1 : 0);
  for (let i = 0; i < n; i++) games.push(i < aHome ? { home: a, away: b } : { home: b, away: a });
};

export const makeMatchups = (teams, rng) => {
  const games = [];
  const byDiv = {};
  for (const t of teams) (byDiv[t.div] ??= []).push(t.tid);

  for (const div of Object.values(byDiv)) {
    // Each team plays its two neighbours on a random ring three times and the other five rivals four times.
    const ring = rng.shuffle([...div]);
    const threeGames = new Set();
    ring.forEach((tid, i) => threeGames.add([tid, ring[(i + 1) % ring.length]].sort((x, y) => x - y).join("-")));
    for (let i = 0; i < div.length; i++) {
      for (let j = i + 1; j < div.length; j++) {
        const key = [div[i], div[j]].sort((x, y) => x - y).join("-");
        addGames(games, div[i], div[j], threeGames.has(key) ? 3 : 4, rng);
      }
    }
  }

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const a = teams[i];
      const b = teams[j];
      if (a.div === b.div) continue;
      addGames(games, a.tid, b.tid, a.conf === b.conf ? 3 : 2, rng);
    }
  }

  // The rest-of-conference count is 8 opponents x 3 = 24, but home/away of
  // odd series is random, so balance home games afterwards.
  balanceHomeGames(games, teams.length, rng);
  return games;
};

// Flip the venue of odd-numbered series games until every team has 41 home games.
const balanceHomeGames = (games, numTeams, rng) => {
  const home = Array(numTeams).fill(0);
  for (const g of games) home[g.home]++;
  for (let pass = 0; pass < 200; pass++) {
    let changed = false;
    for (const g of rng.shuffle([...games])) {
      if (home[g.home] > 41 && home[g.away] < 41) {
        home[g.home]--;
        home[g.away]++;
        [g.home, g.away] = [g.away, g.home];
        changed = true;
      }
    }
    if (!changed) break;
  }
};

// Spread the games over days so nobody plays twice on the same day, giving
// each day's slots to the teams that have played the fewest games so far.
export const makeSchedule = (teams, rng, maxGamesPerDay = 12) => {
  let remaining = makeMatchups(teams, rng).map((g) => ({ ...g, jitter: rng.next() }));
  const played = Array(teams.length).fill(0);
  const days = [];
  while (remaining.length) {
    remaining.sort((a, b) => played[a.home] + played[a.away] + a.jitter - (played[b.home] + played[b.away] + b.jitter));
    const busy = new Set();
    const today = [];
    const later = [];
    for (const g of remaining) {
      if (today.length < maxGamesPerDay && !busy.has(g.home) && !busy.has(g.away)) {
        today.push({ home: g.home, away: g.away });
        busy.add(g.home);
        busy.add(g.away);
      } else {
        later.push({ ...g, jitter: rng.next() });
      }
    }
    for (const g of today) {
      played[g.home]++;
      played[g.away]++;
    }
    days.push(today);
    remaining = later;
  }
  return days;
};
