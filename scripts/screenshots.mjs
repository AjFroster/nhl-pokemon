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
  // A fixed seed, so the screenshots only change when the game does.
  await page.goto("http://localhost:4173/?seed=7");
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
  await page.getByRole("button", { name: "Dashboard" }).click();
  await shot("10-season-over");
  // The draft: your scouts' view of the class, a prospect they haven't seen
  // yet, the lottery and your pick, then your reserve list.
  await page.getByRole("button", { name: "Go to the draft" }).click();
  for (let i = 0; i < 2; i++) await page.locator(".draftclass [data-scout]").first().click();
  await shot("16-draft-class");
  const unseen = await page.locator(".draftclass [data-scout]").first().getAttribute("data-scout");
  await page.locator(`.draftclass [data-player="${unseen}"]`).click();
  await shot("17-prospect");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Hold the lottery" }).click();
  await shot("18-draft-on-the-clock");
  await page.locator("[data-draftpick]").first().click();
  await page.getByRole("button", { name: "Auto-draft the rest" }).click();
  await page.getByRole("button", { name: "Roster" }).click();
  await page.locator(".panel.reserve").scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await page.locator(".panel.reserve").screenshot({ path: `${outDir}19-reserve-list.png` });
  console.log("saved 19-reserve-list.png");
  // Two more seasons, so the history and career lines have something in them.
  for (const year of [2027, 2028]) {
    await page.getByRole("button", { name: `Start the ${year} season` }).click();
    await page.getByRole("button", { name: "Until the playoffs" }).click();
    await waitPhase("playoffs");
    await page.getByRole("button", { name: "Until a champion is crowned" }).click();
    await waitPhase("done");
  }
  await page.locator(".tab[data-go=history]").click();
  await shot("11-history", { fullPage: true });
  await page.locator(".tab[data-go=roster]").click();
  await page.locator("#app [data-player]").first().click();
  await shot("12-career");
  await page.keyboard.press("Escape");
  // Your oldest player, wearing down past his peak.
  const veteran = await page.evaluate(() => {
    const s = window.pokemonNhl.state;
    return s.players.filter((p) => p.tid === s.userTid).sort((a, b) => b.wear - a.wear || a.pid - b.pid)[0].pid;
  });
  await page.locator(`#app [data-player="${veteran}"]`).first().click();
  await shot("15-veteran");
  await page.keyboard.press("Escape");
  // A player of yours who has evolved, or is waiting for you to pick how.
  const evolved = await page.evaluate(() => {
    const s = window.pokemonNhl.state;
    const mine = s.players.filter((p) => p.tid === s.userTid);
    return (mine.find((p) => p.evolveChoices) ?? mine.find((p) => p.evolutions.length))?.pid ?? null;
  });
  if (evolved != null) {
    await page.locator(`#app [data-player="${evolved}"]`).first().click();
    await shot("14-evolution");
    await page.keyboard.press("Escape");
  }
  await page.setViewportSize({ width: 400, height: 860 });
  await page.getByRole("button", { name: "Dashboard" }).click();
  await shot("13-phone");
} finally {
  await browser.close();
  server.kill();
}
