import { test, expect } from "@playwright/test";

// A scripted GM plays the game the way a person would: picks a team, sets
// lines, releases and signs players, plays to a champion, and carries the
// franchise into the next seasons. Each franchise PR adds its screens here
// (draft, re-signing, free agency, trades).

const phase = (page) => page.evaluate(() => window.pokemonNhl.state?.phase ?? null);

test("a bot GM picks a team, manages it and plays into its third season", async ({ page }) => {
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

  // The finished season is in the history before the next one starts.
  await page.locator(".tab[data-go=history]").click();
  await expect(page.locator("table.history tbody tr")).toHaveCount(1);

  // Start the second season: the first stays in the history.
  await page.getByRole("button", { name: "Start the 2027 season" }).click();
  await expect(page.locator(".bar-sub")).toContainText("2027");
  await expect(page.locator(".bar-sub")).toContainText("Day 1 of");
  await page.locator(".tab[data-go=history]").click();
  await expect(page.locator("table.history tbody tr")).toHaveCount(1);
  await expect(page.locator("table.history tbody tr").first()).toContainText("2026");

  // A player's card shows last season as a career line.
  // The league is random, so pick someone on the roster who played last season.
  await page.getByRole("button", { name: "Roster" }).click();
  const veteran = await page.evaluate(() => {
    const { state } = window.pokemonNhl;
    return state.players.find((p) => p.tid === state.userTid && p.career.some((c) => c.tid === state.userTid)).pid;
  });
  await page.locator(`#app [data-player="${veteran}"]`).first().click();
  await expect(page.locator("#player-body")).toContainText("2026 CER");
  await expect(page.locator("#player-body")).toContainText("Career");
  await page.keyboard.press("Escape");

  // Play the second season through, then start the third.
  await page.getByRole("button", { name: "Until the playoffs" }).click();
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe("playoffs");
  await page.getByRole("button", { name: "Until a champion is crowned" }).click();
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe("done");
  await page.getByRole("button", { name: "Start the 2028 season" }).click();
  await page.getByRole("button", { name: "One week" }).click();
  await expect.poll(() => page.evaluate(() => window.pokemonNhl.state.day), { timeout: 30_000 }).toBe(7);
  await page.locator(".tab[data-go=history]").click();
  await expect(page.locator("table.history tbody tr")).toHaveCount(2);
  expect(errors).toEqual([]);
});
