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

  // Home and away of odd-length series is random, so balance home games afterwards.
  balanceHomeGames(games, teams.length);
  return games;
};

// Move home games from teams with too many to teams with too few until every
// team has 41. A direct swap isn't always possible (the two teams may have no
// game left to flip), so this finds the shortest chain of teams instead: A
// gives a home game to B, B gives one to C, and so on. Teams in the middle of
// the chain keep the same count.
const balanceHomeGames = (games, numTeams) => {
  const home = Array(numTeams).fill(0);
  for (const g of games) home[g.home]++;
  const target = games.length / numTeams;
  for (let guard = 0; guard < games.length; guard++) {
    const from = home.findIndex((h) => h > target);
    if (from < 0) return;
    const via = new Map([[from, null]]);
    const queue = [from];
    let to = -1;
    while (queue.length && to < 0) {
      const u = queue.shift();
      if (home[u] < target) to = u;
      else
        for (const g of games)
          if (g.home === u && !via.has(g.away)) {
            via.set(g.away, g);
            queue.push(g.away);
          }
    }
    if (to < 0) return;
    for (let v = to; v !== from; ) {
      const g = via.get(v);
      [g.home, g.away] = [g.away, g.home];
      v = g.away;
    }
    home[from]--;
    home[to]++;
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
