import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import zlib from "node:zlib";
import { migrateSave, SAVE_VERSION } from "../src/save.js";
import { playDay } from "../src/season.js";

const dir = new URL("fixtures/saves/", import.meta.url);
const fixtures = fs.readdirSync(dir).filter((f) => f.endsWith(".json.gz"));
const load = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(f, dir))).toString("utf8"));

test("there is a saved league for every save version", () => {
  for (let v = 1; v <= SAVE_VERSION; v++) assert.ok(fixtures.includes(`v${v}.json.gz`), `missing v${v}.json.gz`);
});

for (const f of fixtures) {
  test(`a league saved as ${f} loads and plays to a champion`, () => {
    const state = migrateSave(load(f));
    assert.ok(state, "the save could not be read");
    assert.equal(state.version, SAVE_VERSION);
    for (let i = 0; i < 400 && state.phase !== "done"; i++) playDay(state);
    assert.equal(state.phase, "done");
    for (const t of state.teams) assert.equal(t.record.w + t.record.l + t.record.otl, 82);
  });
}

test("saves from a newer version, or that aren't leagues, are refused", () => {
  assert.equal(migrateSave(null), null);
  assert.equal(migrateSave({}), null);
  assert.equal(migrateSave({ version: SAVE_VERSION + 1 }), null);
});
