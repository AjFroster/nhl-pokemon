import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { rateSpecies, isLegendary, SKILLS, POSITIONS, TEAMS, CONFERENCES, teamRating } from "../src/ratings.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url), "utf8"));
const byName = Object.fromEntries(dex.map((p) => [p.name, p]));

test("every Pokémon gets all 14 skills and 4 position ratings in range", () => {
  assert.equal(dex.length, 1025);
  for (const p of dex) {
    const { skills, ovrs, best } = rateSpecies(p);
    for (const k of Object.keys(SKILLS)) assert.ok(skills[k] >= 1 && skills[k] <= 100, `${p.name} ${k}`);
    for (const pos of POSITIONS) assert.ok(ovrs[pos] >= 0 && ovrs[pos] <= 100, `${p.name} ${pos}`);
    assert.ok(POSITIONS.includes(best));
  }
});

test("ratings pass the eye test", () => {
  assert.equal(rateSpecies(byName.Snorlax).best, "D");
  assert.equal(rateSpecies(byName.Alakazam).best, "C");
  assert.equal(rateSpecies(byName.Steelix).best, "G");
  assert.ok(rateSpecies(byName.Magikarp).ovrs.C < 30);
  assert.ok(rateSpecies(byName.Lugia).ovrs.G > rateSpecies(byName.Steelix).ovrs.G);
});

test("Legendary limit covers Legendaries, Mythicals and Ultra Beasts but not Paradox Pokémon", () => {
  assert.ok(isLegendary(byName.Mewtwo));
  assert.ok(isLegendary(byName.Mew));
  assert.ok(isLegendary(byName.Pheromosa));
  assert.ok(!isLegendary(byName["Iron Valiant"]));
  assert.ok(!isLegendary(byName.Garchomp));
});

test("league has 32 teams in 4 divisions of 8", () => {
  assert.equal(TEAMS.length, 32);
  const divs = Object.values(CONFERENCES).flat();
  assert.equal(divs.length, 4);
  for (const d of divs) assert.equal(TEAMS.filter((t) => t.div === d).length, 8);
});

test("a weak spot in the lineup drags the team rating down", () => {
  const even = { C: [60, 60, 60, 60], W: Array(8).fill(60), D: Array(6).fill(60), G: [60, 55] };
  const holes = { ...even, D: [60, 60, 60, 60, 30, 30] };
  assert.ok(teamRating(holes) < teamRating(even));
});
