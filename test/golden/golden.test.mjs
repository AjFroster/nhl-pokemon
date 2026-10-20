import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { CASES, goldenFile, runCase } from "./cases.mjs";

for (const c of CASES) {
  test(`golden seed: ${c.name}`, () => {
    const file = goldenFile(c.name);
    assert.ok(fs.existsSync(file), `${c.name}.json is missing. Run npm run golden:update and commit it.`);
    const want = JSON.parse(fs.readFileSync(file, "utf8"));
    const got = runCase(c);
    assert.deepEqual(
      got,
      want,
      `${c.name} played out differently. If the change is intended, run npm run golden:update and commit the files.`,
    );
  });
}

test("the same seed gives the same league twice in one process", () => {
  assert.deepEqual(runCase(CASES[1]), runCase(CASES[1]));
});
