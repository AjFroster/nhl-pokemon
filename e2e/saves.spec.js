import { test, expect } from "@playwright/test";
import fs from "node:fs";
import zlib from "node:zlib";

// A league saved by every earlier version of the game must still load and play.
// The saves are made with npm run save-fixture before each save version bump.
const dir = new URL("../test/fixtures/saves/", import.meta.url);
const saves = fs.readdirSync(dir).filter((f) => f.endsWith(".json.gz"));

for (const file of saves) {
  test(`a league saved as ${file} loads and plays on`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const save = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(file, dir))).toString("utf8"));
    const team = save.teams[save.userTid];

    // Put the old save where the game keeps its league, then load the game.
    await page.goto("/");
    await page.evaluate(
      (state) =>
        new Promise((resolve, reject) => {
          const req = indexedDB.open("pokemon-nhl", 1);
          req.onupgradeneeded = () => req.result.createObjectStore("leagues");
          req.onsuccess = () => {
            const tx = req.result.transaction("leagues", "readwrite");
            tx.objectStore("leagues").put(state, "current");
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
          req.onerror = () => reject(req.error);
        }),
      save,
    );
    await page.reload();

    await expect(page.locator(".bar-name")).toHaveText(`${team.city} ${team.name}`);
    const day = await page.evaluate(() => window.pokemonNhl.state.day);
    expect(day).toBe(save.day);
    await page.getByRole("button", { name: "One week" }).click();
    await expect.poll(() => page.evaluate(() => window.pokemonNhl.state.day), { timeout: 30_000 }).toBe(day + 7);
    expect(errors).toEqual([]);
  });
}
