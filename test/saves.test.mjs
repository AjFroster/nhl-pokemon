import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { migrateSave, SAVE_VERSION } from "../src/save.js";
import { playDay } from "../src/season.js";
import { startNextSeason } from "../src/offseason.js";

const dex = JSON.parse(fs.readFileSync(new URL("../data/pokedex.json", import.meta.url)));
const dir = new URL("fixtures/saves/", import.meta.url);
const fixtures = fs.readdirSync(dir).filter((f) => f.endsWith(".json.gz"));
const load = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(f, dir))).toString("utf8"));

test("there is a saved league for every save version", () => {
  for (let v = 1; v <= SAVE_VERSION; v++) assert.ok(fixtures.includes(`v${v}.json.gz`), `missing v${v}.json.gz`);
});

for (const f of fixtures) {
  test(`a league saved as ${f} loads, plays to a champion and starts the next season`, () => {
    const state = migrateSave(load(f), dex);
    assert.ok(state, "the save could not be read");
    assert.equal(state.version, SAVE_VERSION);
    for (const p of state.players) {
      assert.ok(p.level >= 2 && p.level <= 100, `${p.name} has level ${p.level}`);
      assert.equal(Object.keys(p.ivs).length, 6);
      assert.ok(p.nature && p.nickname);
    }
    for (let i = 0; i < 400 && state.phase !== "done"; i++) playDay(state);
    assert.equal(state.phase, "done");
    for (const t of state.teams) assert.equal(t.record.w + t.record.l + t.record.otl, 82);
    const season = state.season;
    startNextSeason(state);
    assert.equal(state.season, season + 1);
    assert.equal(state.history.at(-1).season, season);
    playDay(state);
    assert.equal(state.day, 1);
  });
}

test("upgrading an old save to individuals is the same every time", () => {
  const v2 = fixtures.find((f) => f === "v2.json.gz");
  const a = migrateSave(load(v2), dex);
  const b = migrateSave(load(v2), dex);
  assert.deepEqual(a, b);
});

test("saves from a newer version, or that aren't leagues, are refused", () => {
  assert.equal(migrateSave(null), null);
  assert.equal(migrateSave({}), null);
  assert.equal(migrateSave({ version: SAVE_VERSION + 1 }), null);
});
