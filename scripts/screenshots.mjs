// Plays a season in a real browser and saves screenshots to docs/screenshots/.
// Run `npm run build` first.
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import fs from "node:fs";

const outDir = new URL("../docs/screenshots/", import.meta.url).pathname;
fs.mkdirSync(outDir, { recursive: true });
const server = spawn(process.execPath, [new URL("serve.mjs", import.meta.url).pathname], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: "light" });
const shot = async (name, opts = {}) => {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${outDir}${name}.png`, ...opts });
  console.log(`saved ${name}.png`);
};
const phase = () => page.evaluate(() => window.pokemonNhl.state?.phase ?? null);
const waitPhase = async (want) => {
  for (let i = 0; i < 600 && (await phase()) !== want; i++) await page.waitForTimeout(100);
};

try {
  await page.goto("http://localhost:4173/");
  await page.locator("[data-pick]").first().waitFor();
  await shot("1-pick-a-team");
  await page.locator('[data-pick="12"]').click();
  for (let i = 0; i < 20; i++) await page.getByRole("button", { name: "Next day" }).click();
  await page.waitForTimeout(300);
  await shot("2-dashboard");
  await page.getByRole("button", { name: "Lines" }).click();
  await shot("3-lines");
  await page.getByRole("button", { name: "Until the playoffs" }).click();
  await waitPhase("playoffs");
  await page.getByRole("button", { name: "Standings" }).click();
  await shot("4-standings", { fullPage: true });
  await page.getByRole("button", { name: "Roster" }).click();
  await shot("5-roster");
  await page.locator("#app [data-player]").first().click();
  await shot("6-player");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Leaders" }).click();
  await shot("7-leaders");
  await page.getByRole("button", { name: "Until a champion is crowned" }).click();
  await waitPhase("done");
  await page.locator(".tab[data-go=playoffs]").click();
  await shot("8-playoffs");
  await page.locator(".tab[data-go=schedule]").click();
  await page.locator(".gameline").first().click();
  await shot("9-box-score", { fullPage: true });
  await page.setViewportSize({ width: 400, height: 860 });
  await page.getByRole("button", { name: "Dashboard" }).click();
  await shot("10-phone");
} finally {
  await browser.close();
  server.kill();
}
