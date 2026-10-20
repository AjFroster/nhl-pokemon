import { test, expect } from "@playwright/test";

// A scripted GM plays the game the way a person would: picks a team, sets
// lines, releases and signs players, and plays to a champion. Each franchise
// PR adds its screens here (draft, re-signing, free agency, trades) and more
// seasons.

const phase = (page) => page.evaluate(() => window.pokemonNhl.state?.phase ?? null);

test("a bot GM picks a team, manages it and plays a full season", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Pick your franchise" })).toBeVisible();
  await expect(page.locator("[data-pick]")).toHaveCount(32);
  await page.locator('[data-pick="1"]').click();
  await expect(page.locator(".bar-name")).toHaveText("Cerulean Cascades");

  // One day, then check the scores appear.
  await page.getByRole("button", { name: "Next day" }).click();
  await expect(page.locator(".scorecard").first()).toBeVisible();

  // Lines: pick a different starting goalie and the backup takes his place.
  await page.getByRole("button", { name: "Lines" }).click();
  const starter = page.locator("#slot-G-0-0");
  const backup = page.locator("#slot-G-1-0");
  const [s0, b0] = [await starter.inputValue(), await backup.inputValue()];
  await starter.selectOption(b0);
  await expect(page.locator("#slot-G-0-0")).toHaveValue(b0);
  await expect(page.locator("#slot-G-1-0")).toHaveValue(s0);

  // Roster: release a player, then sign a free agent.
  await page.getByRole("button", { name: "Roster" }).click();
  await page.locator("[data-release]").first().click();
  await page.getByRole("button", { name: "Release" }).last().click();
  await expect(page.locator(".notice")).toContainText("was released");
  await page.getByRole("button", { name: "Free agents" }).click();
  await page.locator("[data-sign]:not([disabled])").first().click();
  await expect(page.locator(".notice")).toContainText("signed");

  // Play to the playoffs, then to a champion.
  await page.getByRole("button", { name: "Until the playoffs" }).click();
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe("playoffs");
  await page.getByRole("button", { name: "Standings" }).click();
  await expect(page.locator("table.data tbody tr")).toHaveCount(32);
  await page.getByRole("button", { name: "Until a champion is crowned" }).click();
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe("done");
  await page.locator(".tab[data-go=playoffs]").click();
  await expect(page.locator(".viewhead")).toContainText("Champion:");

  // A box score opens from the bracket.
  await page.locator(".series").first().click();
  await expect(page.getByRole("heading", { name: "Box score" })).toBeVisible();

  // The league survives a reload.
  await page.reload();
  await expect(page.locator(".bar-name")).toHaveText("Cerulean Cascades");
  expect(await phase(page)).toBe("done");
  expect(errors).toEqual([]);
});
