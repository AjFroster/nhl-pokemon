# Pokémon NHL

A hockey franchise GM game, in the spirit of ZenGM Hockey, where every player is a Pokémon. It's inspired by the franchise mode of the fan game Pokémon All-22.

## Roadmap

Each step lands as its own pull request into `master`.

1. **Map Pokémon to hockey** (done): skills, position ratings, teams and league rules.
2. **A playable single season** (done): league setup, rosters and lines, game simulation, standings and playoffs.
3. **The franchise layer**, in PRs 3.0 to 3.10: CI foundation (done), seasons that roll over (done), Pokémon as individuals with levels, IVs and natures (done), growth and evolution (in review, merging together with aging and the draft), aging and retirement, the draft, contracts and the cap, mood and negotiation, free agency, trades, and injuries.
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
npm run health -- --seed 1   # league health for one seed: 4 leagues of 10 seasons in a row
```

Start a league from a fixed seed with `http://localhost:4173/?seed=123`. The same seed and team always play out the same way.

`dist/index.html` is one self-contained file. It also works opened straight from disk, but serving it lets the browser keep your league between visits.

## Playing a season

1. **Pick your franchise.** All 32 teams run a snake fantasy draft over every Pokémon, picking the best value at the positions they still need. Each species appears once, and each team may carry one Legendary. Choose the team you want to run, or run the draft again.
2. **Set your lines.** Four forward lines, three defense pairs and two goalies. The top line plays the most and forms the power play.
3. **Make moves.** Release players and sign any undrafted Pokémon as a free agent, up to 23 players.
4. **Play.** Advance a day, a week, a month or straight to the playoffs. Every game is simulated in 10-second ticks: the skaters on the ice decide who shoots, blocks, hits and scores, and the goalie's rating decides saves. There are penalties and power plays, late pulled goalies, 3-on-3 overtime and shootouts in the regular season, and sudden-death overtime in the playoffs.
5. **Win the Cup.** The top eight in each conference play best-of-seven rounds.
6. **Grow your Pokémon.** Players earn XP from every game and from training camp, level up and evolve. When one of yours can evolve more than one way, you pick which on his card.

The league saves in your browser after every change.

## Testing and CI

Every PR runs three GitHub Actions workflows. Each says what kind of thing broke.

| Workflow               | Question                         | Jobs                                                                                                                                                              |
| ---------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Code checks**        | Is the code right?               | Lint and format, unit tests, golden seeds on Node 22 and 24, and build, all in parallel                                                                           |
| **Season simulations** | Is the league still sane?        | One job per seed (4 fixed seeds on PRs) plays 4 leagues of 10 seasons in a row headless, one league per core, then a report job writes a table to the run summary |
| **Browser play tests** | Does the game work in a browser? | Builds the game once, then the full season, bot GM, old saves and screenshots jobs run in parallel on that build                                                  |

**Reproducibility.** All randomness comes from the league's seeded generator in [`src/random.js`](src/random.js), and ESLint fails on `Math.random` or the clock anywhere else in the game logic. Golden seeds in [`test/golden/`](test/golden/) commit a readable summary and a hash of the whole league for fixed seeds. If a change alters any result, Code checks fails until you run `npm run golden:update` and commit the new files, so every change to how the game plays shows up in review. The browser plays seed 1 and must reach the same hash as Node, and reloading mid-season must not change it.

**Season simulations.** [`scripts/league-health.mjs`](scripts/league-health.mjs) checks hard rules (82 games and 41 at home for everyone, legal rosters and lineups, a full playoff bracket) and keeps game-feel numbers in bands: goals, shots, save percentage, overtime and shootouts, home wins, penalties, parity and the scoring leader. The bands are about five standard deviations around the mean of 120 simulated leagues; `npm run health -- --calibrate 120` prints the spread again after an intended change. Each league rolls over between seasons, so the checks also catch a broken rollover: everyone ages a year, the season lands in the history, and the save stays small. A nightly run plays 8 random seeds of 4 leagues, 25 seasons each, and opens an issue with the seeds if anything fails. Any failure can be replayed with `npm run health -- --seed <seed> --seasons <n> --leagues <n>`.

**Saves.** Every save carries a version, and [`src/save.js`](src/save.js) upgrades old versions. Before bumping `SAVE_VERSION`, run `npm run save-fixture` to keep a league saved by the current version in [`test/fixtures/saves/`](test/fixtures/saves/). Unit tests and the browser both load every fixture and play on.

## How a Pokémon becomes a hockey player

Every player is one individual Pokémon ([`src/individual.js`](src/individual.js)). He has a level, an IV from 0 to 31 for each stat, a nature that raises one stat by 10% and lowers another, and a nickname. His six stats come from the games' own formulas, so two players of the same species differ. The player card shows the stats, the nature and each IV as the in-game judge would describe it ("Pretty good", "Best").

In a new league, older players start at higher levels, centred on level 50. A level 50 player with average IVs and a neutral nature rates exactly as his species did before levels existed. Middle forms start below the level where they evolve, so a level 34 Charmeleon is weak now but becomes a Charizard later.

The rest lives in [`src/ratings.js`](src/ratings.js).

1. **Stats, height and weight become 14 hockey skills.** The stats are first converted back to the base-stat scale at level 50. These are the same skills ZenGM Hockey uses: height, strength, skating speed, endurance, passing, wrist shot, slap shot, stickhandling, offensive IQ, checking, shot blocking, faceoffs, defensive IQ and goaltending. Each skill blends a few stats. For example, checking is 40% Attack, 35% weight and 25% Defense. Height and weight are converted onto the base-stat scale first. Stats above 130 count at half rate, so outliers don't break the scale.
2. **Types add small nudges.** Ice types skate faster, Fire types tire faster on the ice, Psychic types read the play, and so on.
3. **Skills become a rating at C, W, D and G.** Each position rating is a weighted average of the skills that matter there. A Pokémon's natural position is the one where it rates highest.
4. **Team strength weights lines by ice time.** The four weakest dressed players then pull the team rating down, as in All-22.

## Growth and evolution

Players grow as in the games ([`src/growth.js`](src/growth.js)).

- **XP.** Every game pays XP for ice time, points and a win, and playoff games pay half again. Training camp before each season adds more. Young players learn fastest: XP is worth 1.5 times as much at 21 and under, and only a fifth after 30. Each species levels on its own experience curve from the games (fast, medium, medium-slow, slow, erratic or fluctuating). Levels past 70 count at half rate for skills.
- **Potential tier.** Every player has a hidden tier that multiplies his XP: Poké (60% of players, ×1), Great (28%, ×1.25), Ultra (10%, ×1.5) and Master (2%, ×2). After each season the top 5% of players against what their rating predicts have a breakout, which raises the tier of anyone 26 or younger. The bottom 5% have a bust, which lowers it, but never more than one step below where he started.
- **Evolution.** Level evolutions happen on the level-up that reaches the level. Stone evolutions happen at the next training camp after a breakout season. Friendship evolutions happen at the camp after three seasons on one team. Trade evolutions wait for trades. Species whose method has no hockey meaning yet (a move, a held item) evolve at level 36. A player who evolves keeps his level, IVs and nature. CPU teams pick the branch that rates best at the player's position.
- **POT.** A player's potential is the best rating his final forms would reach at level 60, or at his level if he is past it, and never below his rating now. You see it exactly for your own players and as a scouting estimate, off by up to four, for everyone else.

The simulator measures every rating against the league's average that day, so a league that grows as a whole keeps scoring like the NHL. Better players still win more.

Until aging and the draft arrive, a league grows a little stronger each season, so the season simulations allow the average rostered player's rating to climb up to 5 points a season. Growth and evolution, aging and retirement, and the draft merge together, and the draft tightens that check back to flat.

## The league

There are 32 Gym Leader teams in four divisions, one each for Kanto, Johto, Hoenn and Sinnoh. The divisions are split into two conferences, the same shape as the NHL. Each season has 82 games, then 16 teams play best-of-seven playoff rounds. Rosters hold 23 players, with 12 forwards, 6 defensemen and 2 goalies dressed each game. Each team may carry one Legendary, and Mythicals and Ultra Beasts count as Legendaries.

## Data

[`data/pokedex.json`](data/pokedex.json) holds the 1,025 base species with base stats, size, types, evolution links and growth rates. It comes from [Pokémon Showdown](https://github.com/smogon/pokemon-showdown)'s Pokédex (MIT licensed), with how each species evolves (level, item, trade or friendship). Growth rates come from [PokeAPI](https://github.com/PokeAPI/pokeapi)'s data files (BSD licensed). Run `npm run import-pokedex` to rebuild it.

Pokémon is © Nintendo, Game Freak and The Pokémon Company. This is a non-commercial fan project. No ZenGM code is used: ZenGM's license doesn't allow redistributing playable versions, so it serves only as a design reference.
