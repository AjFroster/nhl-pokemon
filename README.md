# Pokémon NHL

A hockey franchise GM game, in the spirit of ZenGM Hockey, where every player is a Pokémon. It's inspired by the franchise mode of the fan game Pokémon All-22.

## Roadmap

Each step lands as its own pull request into `master`.

1. **Map Pokémon to hockey** (done): skills, position ratings, teams and league rules.
2. A playable single season: league setup, rosters and lines, game simulation, standings and playoffs.
3. The franchise layer: multiple seasons, the draft, contracts and the cap, trades, injuries, and evolution, aging and retirement.
4. Optional: tune the simulation against the original All-22 franchise mode.

## Getting started

You need Node.js 20 or newer. There are no dependencies to install.

```sh
npm test          # check the rating model
npm run build     # build dist/scouting-board.html, then open it in a browser
```

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
