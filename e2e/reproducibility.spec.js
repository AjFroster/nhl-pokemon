import { test, expect } from "@playwright/test";
import fs from "node:fs";

// The browser must play a seed exactly as Node does. "season-seed-1" is a
// golden seed played in Node with team 1; see test/golden/cases.mjs.
const golden = JSON.parse(fs.readFileSync(new URL("../test/golden/season-seed-1.json", import.meta.url), "utf8"));

const phase = (page) => page.evaluate(() => window.pokemonNhl.state?.phase ?? null);
const hash = (page) => page.evaluate(() => window.pokemonNhl.hash());

const startSeedOne = async (page) => {
  await page.goto("/?seed=1");
  await page.locator('[data-pick="1"]').click();
  await expect(page.locator(".bar-name")).toHaveText("Cerulean Cascades");
};

const playToChampion = async (page) => {
  if ((await phase(page)) === "regular") {
    await page.getByRole("button", { name: "Until the playoffs" }).click();
    await expect.poll(() => phase(page), { timeout: 60_000 }).toBe("playoffs");
  }
  await page.getByRole("button", { name: "Until a champion is crowned" }).click();
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe("done");
};

test("a season played in the browser matches the Node golden seed exactly", async ({ page }) => {
  await startSeedOne(page);
  await playToChampion(page);
  expect(await hash(page)).toBe(golden.stateHash);
});

test("saving and reloading mid-season doesn't change how the season ends", async ({ page }) => {
  await startSeedOne(page);
  await page.getByRole("button", { name: "One month" }).click();
  await expect
    .poll(() => page.evaluate(() => window.pokemonNhl.state.day), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(30);
  await expect(page.getByRole("button", { name: "One month" })).toBeEnabled();
  await page.reload();
  await expect(page.locator(".bar-name")).toHaveText("Cerulean Cascades");
  await playToChampion(page);
  expect(await hash(page)).toBe(golden.stateHash);
});
