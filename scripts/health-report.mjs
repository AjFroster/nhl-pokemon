// Turns the league health JSON files from every seed into one Markdown report.
//   node scripts/health-report.mjs <folder with seed-*.json> >> "$GITHUB_STEP_SUMMARY"
import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2] ?? "health";
const reports = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")))
  .sort((a, b) => a.seed - b.seed);

const fmt = (k, v) => (k.endsWith("Pct") || k.endsWith("Share") || k === "savePct" ? v.toFixed(3) : v.toFixed(2));
const lines = [];
const failed = reports.filter((r) => !r.ok);
const seeds = (n) => `${n} seed${n === 1 ? "" : "s"}`;
lines.push(`## League health: ${failed.length ? `${failed.length} of ${seeds(reports.length)} failed` : `all ${seeds(reports.length)} passed`}`);
lines.push("");
if (!reports.length) {
  lines.push("No reports were found. The seed jobs may have crashed before writing one.");
} else {
  const keys = Object.keys(reports[0].bands);
  lines.push(`| Measure | Band | ${reports.map((r) => `Seed ${r.seed}`).join(" | ")} |`);
  lines.push(`|---|---|${reports.map(() => "---|").join("")}`);
  for (const k of keys) {
    const [lo, hi] = reports[0].bands[k];
    const cells = reports.map((r) => {
      const xs = r.results.map((x) => x.metrics[k]);
      const out = xs.some((x) => x < lo || x > hi);
      return `${fmt(k, Math.min(...xs))} to ${fmt(k, Math.max(...xs))}${out ? " ❌" : ""}`;
    });
    lines.push(`| ${k} | ${lo} to ${hi} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push(`Each cell is the lowest to highest value over ${reports[0].seasons} seasons.`);
  for (const r of failed) {
    lines.push("");
    lines.push(`### Seed ${r.seed}`);
    for (const s of r.results.filter((x) => x.failures.length)) {
      for (const f of s.failures) lines.push(`- Season ${s.season} (league seed ${s.leagueSeed}): ${f.msg}`);
    }
    lines.push("");
    lines.push(`Replay with \`npm run health -- --seed ${r.seed} --seasons ${r.seasons}\`.`);
  }
}
console.log(lines.join("\n"));
