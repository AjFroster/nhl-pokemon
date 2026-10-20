# Pokémon NHL

A hockey franchise GM game, in the spirit of ZenGM Hockey, where every player is a Pokémon. It's inspired by the franchise mode of the fan game Pokémon All-22.

## Roadmap

Each step lands as its own pull request into `master`.

1. **Map Pokémon to hockey** (done): skills, position ratings, teams and league rules.
2. **A playable single season** (done): league setup, rosters and lines, game simulation, standings and playoffs.
3. **The franchise layer**, in PRs 3.0 to 3.10: CI foundation (done), seasons that roll over, Pokémon as individuals with levels, IVs and natures, growth and evolution, aging and retirement, the draft, contracts and the cap, mood and negotiation, free agency, trades, and injuries.
4. Optional: tune the simulation against the original All-22 franchise mode.

## Getting started

You need Node.js 22 or newer.

```sh
npm install
npm run build                # builds dist/index.html (the game) and dist/scouting-board.html
npm start                    # serves the game at http://localhost:4173
npm test                     # unit tests: ratings, schedule, simulator, saves, league health checks
npm run test:golden          # golden seeds: fixed seeds must play out exactly as committed
npm run test:e2e             # browser tests: bot GM, browser matches Node, old saves load
npm run lint                 # ESLint and Prettier (npm run format fixes what it can)
npm run health -- --seed 1   # league health for one seed, 10 seasons
```

Start a league from a fixed seed with `http://localhost:4173/?seed=123`. The same seed and team always play out the same way.

`dist/index.html` is one self-contained file. It also works opened straight from disk, but serving it lets the browser keep your league between visits.

## Playing a season

1. **Pick your franchise.** All 32 teams run a snake fantasy draft over every Pokémon, picking the best value at the positions they still need. Each species appears once, and each team may carry one Legendary. Choose the team you want to run, or run the draft again.
2. **Set your lines.** Four forward lines, three defense pairs and two goalies. The top line plays the most and forms the power play.
3. **Make moves.** Release players and sign any undrafted Pokémon as a free agent, up to 23 players.
4. **Play.** Advance a day, a week, a month or straight to the playoffs. Every game is simulated in 10-second ticks: the skaters on the ice decide who shoots, blocks, hits and scores, and the goalie's rating decides saves. There are penalties and power plays, late pulled goalies, 3-on-3 overtime and shootouts in the regular season, and sudden-death overtime in the playoffs.
5. **Win the Cup.** The top eight in each conference play best-of-seven rounds.

The league saves in your browser after every change.

## Testing and CI

Every PR runs three GitHub Actions workflows. Each says what kind of thing broke.

| Workflow               | Question                         | Jobs                                                                                                                                                      |
| ---------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code checks**        | Is the code right?               | Lint and format, unit tests, golden seeds on Node 22 and 24, and build, all in parallel                                                                   |
| **Season simulations** | Is the league still sane?        | One job per seed (4 fixed seeds on PRs) plays 10 seasons headless, in parallel on the runner's cores, then a report job writes a table to the run summary |
| **Browser play tests** | Does the game work in a browser? | Builds the game once, then the full season, bot GM, old saves and screenshots jobs run in parallel on that build                                          |

**Reproducibility.** All randomness comes from the league's seeded generator in [`src/random.js`](src/random.js), and ESLint fails on `Math.random` or the clock anywhere else in the game logic. Golden seeds in [`test/golden/`](test/golden/) commit a readable summary and a hash of the whole league for fixed seeds. If a change alters any result, Code checks fails until you run `npm run golden:update` and commit the new files, so every change to how the game plays shows up in review. The browser plays seed 1 and must reach the same hash as Node, and reloading mid-season must not change it.

**Season simulations.** [`scripts/league-health.mjs`](scripts/league-health.mjs) checks hard rules (82 games and 41 at home for everyone, legal rosters and lineups, a full playoff bracket) and keeps game-feel numbers in bands: goals, shots, save percentage, overtime and shootouts, home wins, penalties, parity and the scoring leader. The bands are about five standard deviations around the mean of 120 simulated leagues; `npm run health -- --calibrate 120` prints the spread again after an intended change. A nightly run plays 8 random seeds for 25 seasons each and opens an issue with the seeds if anything fails. Any failure can be replayed with `npm run health -- --seed <seed> --seasons <n>`.

**Saves.** Every save carries a version, and [`src/save.js`](src/save.js) upgrades old versions. Before bumping `SAVE_VERSION`, run `npm run save-fixture` to keep a league saved by the current version in [`test/fixtures/saves/`](test/fixtures/saves/). Unit tests and the browser both load every fixture and play on.

## How a Pokémon becomes a hockey player

All of this lives in [`src/ratings.js`](src/ratings.js).

1. **Base stats, height and weight become 14 hockey skills.** These are the same skills ZenGM Hockey uses: height, strength, skating speed, endurance, passing, wrist shot, slap shot, stickhandling, offensive IQ, checking, shot blocking, faceoffs, defensive IQ and goaltending. Each skill blends a few stats. For example, checking is 40% Attack, 35% weight and 25% Defense. Height and weight are converted onto the base-stat scale first. Stats above 130 count at half rate, so outliers don't break the scale.
2. **Types add small nudges.** Ice types skate faster, Fire types tire faster on the ice, Psychic types read the play, and so on.
3. **Skills become a rating at C, W, D and G.** Each position rating is a weighted average of the skills that matter there. A Pokémon's natural position is the one where it rates highest.
4. **Team strength weights lines by ice time.** The four weakest dressed players then pull the team rating down, as in All-22.

## The league

There are 32 Gym Leader teams in four divisions, one each for Kanto, Johto, Hoenn and Sinnoh. The divisions are split into two conferences, the same shape as the NHL. Each season has 82 games, then 16 teams play best-of-seven playoff rounds. Rosters hold 23 players, with 12 forwards, 6 defensemen and 2 goalies dressed each game. Each team may carry one Legendary, and Mythicals and Ultra Beasts count as Legendaries.

## Data

[`data/pokedex.json`](data/pokedex.json) holds the 1,025 base species with base stats, size, types and evolution links. It comes from [Pokémon Showdown](https://github.com/smogon/pokemon-showdown)'s Pokédex (MIT licensed). Run `npm run import-pokedex` to rebuild it.

Pokémon is © Nintendo, Game Freak and The Pokémon Company. This is a non-commercial fan project. No ZenGM code is used: ZenGM's license doesn't allow redistributing playable versions, so it serves only as a design reference.
