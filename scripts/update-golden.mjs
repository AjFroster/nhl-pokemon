// Rewrites the golden seed files in test/golden/ from the current code.
import fs from "node:fs";
import { CASES, goldenFile, runCase } from "../test/golden/cases.mjs";

for (const c of CASES) {
  const file = goldenFile(c.name);
  const next = `${JSON.stringify(runCase(c), null, 2)}\n`;
  const prev = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  fs.writeFileSync(file, next);
  console.log(`${prev === next ? "unchanged" : prev ? "updated  " : "created  "} test/golden/${c.name}.json`);
}
