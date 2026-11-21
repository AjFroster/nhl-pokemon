import { test, expect } from "@playwright/test";

// A scripted GM plays the game the way a person would: picks a team, sets
// lines, releases and signs players, plays to a champion, scouts and drafts
// prospects, and carries the franchise into the next seasons. Each franchise
// PR adds its screens here (re-signing and moods, free agency, trades).

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

  // The draft: scout a prospect, hold the lottery, make your picks in the
  // first two rounds, then let your scouts finish it.
  await page.getByRole("button", { name: "Go to the draft" }).click();
  await expect(page.locator(".viewhead h1")).toHaveText("2026 draft");
  const pid = await page.locator(".draftclass [data-scout]").first().getAttribute("data-scout");
  await page.locator(`.draftclass [data-player="${pid}"]`).click();
  await expect(page.locator("#player-body .eyebrow")).toContainText("2026 draft prospect");
  await expect(page.locator("#player-body .fog")).toBeVisible();
  await page.locator("#player-body [data-scout]").click();
  await expect(page.locator("#player-body .fog")).toHaveCount(0);
  await expect(page.locator("#player-body .mon .stat")).toHaveCount(6);
  await page.keyboard.press("Escape");
  await expect(page.locator(`.draftclass tr:has([data-player="${pid}"]) .tag.scouted`)).toBeVisible();
  await page.getByRole("button", { name: "Hold the lottery" }).click();
  await expect(page.locator("ol.lottery li")).toHaveCount(16);
  for (const round of [1, 2]) {
    await expect(page.locator(".view > .note")).toContainText(`of round ${round}.`);
    const name = await page.locator(".draftclass tbody tr [data-player]").first().textContent();
    await page.locator("[data-draftpick]").first().click();
    await expect(page.locator(".notice")).toContainText(`You drafted ${name} with pick`);
  }
  await page.getByRole("button", { name: "Auto-draft the rest" }).click();
  await expect(page.locator(".notice")).toContainText("The draft is over");
  await expect(page.locator("[data-draftround]")).toHaveCount(7);
  // Your seven picks wait on your reserve list. The roster is full, so none
  // can be called up yet.
  await page.getByRole("button", { name: "Roster" }).click();
  await expect(page.locator(".panel.reserve tbody tr")).toHaveCount(7);
  await expect(page.locator(".panel.reserve [data-callup]").first()).toBeDisabled();

  // The re-sign window: the dashboard points to the payroll screen. Every
  // expiring contract shows the player's mood and what it does to his ask.
  await page.getByRole("button", { name: "Dashboard" }).click();
  await page.getByRole("button", { name: "Re-sign the players you want to keep" }).click();
  await expect(page.locator(".viewhead h1")).toHaveText("Payroll");
  await expect(page.locator(".panel.resign h2")).toHaveText("Re-sign window");
  const due = await page.locator(".panel.resign tbody tr").evaluateAll((trs) =>
    trs.map((tr) => ({
      pid: Number(tr.dataset.pid),
      mood: tr.dataset.mood,
      markup: Number(tr.dataset.markup),
      text: tr.textContent,
      open: !!tr.querySelector("[data-resign]:not([disabled])"),
      talks: !!tr.querySelector("[data-resign]"),
    })),
  );
  expect(due.length).toBeGreaterThan(1);
  for (const row of due) {
    expect(["happy", "content", "restless", "unhappy", "fedup"]).toContain(row.mood);
    expect(row.talks).toBe(row.mood !== "fedup");
    if (!row.talks) expect(row.text).toContain("Won't talk");
    else if (row.markup > 0) expect(row.text).toContain(`+${row.markup}%`);
    expect(row.markup).toBeLessThanOrEqual(50);
  }
  // Try to re-sign the least happy player. He either won't talk, and his card
  // says why, or he signs for more than a happier player would.
  const least = [...due].sort((a, b) => b.markup - a.markup || a.pid - b.pid)[0];
  if (!least.talks) {
    await expect(page.locator(`.panel.resign tr[data-pid="${least.pid}"] button[disabled]`)).toHaveText("Won't talk");
    await page.locator(`.panel.resign [data-player="${least.pid}"]`).click();
    await expect(page.locator("#player-body .mood-fedup")).toBeVisible();
    await expect(page.locator("#player-body")).toContainText("won't talk about a new contract");
    await page.keyboard.press("Escape");
  }
  // Re-sign one player (the least happy who will sign) and let another walk.
  const keep = (due.find((r) => r.pid === least.pid && r.open) ?? due.find((r) => r.open))?.pid;
  const walk = due.find((r) => r.pid !== keep)?.pid;
  expect(keep).toBeDefined();
  expect(walk).toBeDefined();
  await page.locator(`.panel.resign [data-player="${keep}"]`).click();
  await expect(page.locator("#player-body .moodpanel .mood")).toBeVisible();
  await expect(page.locator("#player-body .moodpanel .trait").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await page.locator(`[data-resign="${keep}"]`).click();
  await expect(page.locator(".notice")).toContainText("re-signed for");
  await expect(page.locator(`[data-resign="${keep}"]`)).toHaveCount(0);
  await expect(page.locator(`.panel.resign tr[data-pid="${walk}"]`)).toBeVisible();

  // The finished season is in the history before the next one starts.
  await page.locator(".tab[data-go=history]").click();
  await expect(page.locator("table.history tbody tr")).toHaveCount(1);

  // Free agency: before it opens nobody can be signed. Opening it sends the
  // player you didn't re-sign to market, and he won't come straight back.
  await page.getByRole("button", { name: "Free agents" }).click();
  await expect(page.locator("table.fa [data-sign]").first()).toBeDisabled();
  await page.getByRole("button", { name: "Open free agency" }).click();
  await page.locator("#confirm [data-yes]").click();
  await expect(page.locator(".viewhead h1")).toHaveText("Free agency");
  await expect(page.locator(".notice")).toContainText("Free agency is open");
  await expect(page.locator(".view > .note").first()).toContainText("Round 1 of 5");
  expect(await page.evaluate((w) => window.pokemonNhl.state.players[w].tid, walk)).toBe(-1);

  // Bid for a star: meet the ask of the best free agent the cap allows.
  const targets = await page
    .locator("table.fa [data-offer]")
    .evaluateAll((bs) => bs.slice(0, 40).map((b) => Number(b.dataset.offer)));
  let star = null;
  for (const pid of targets) {
    await page.locator(".notice").evaluate((n) => (n.textContent = ""));
    await page.locator(`[data-offer="${pid}"]`).click();
    await expect(page.locator(".notice")).toContainText(/You offered|under the cap/);
    if ((await page.locator(".notice").textContent()).includes("You offered")) {
      star = pid;
      break;
    }
  }
  expect(star).not.toBeNull();
  await expect(page.locator(`.panel.offers tr[data-offered="${star}"]`)).toContainText("Meets his ask");
  // A low offer to someone else waits for his ask to fall. Withdraw it.
  const pricey = await page.evaluate(
    ([ids, taken]) => ids.find((pid) => pid !== taken && Number(document.getElementById(`bid-${pid}`).value) > 3),
    [targets, star],
  );
  await page.locator(`#bid-${pricey}`).fill("1.5");
  await page.locator(`#yrs-${pricey}`).selectOption("1");
  await page.locator(`[data-offer="${pricey}"]`).click();
  await expect(page.locator(".notice")).toContainText("under his ask this round");
  await expect(page.locator(`.panel.offers tr[data-offered="${pricey}"]`)).toContainText("Under his ask");
  await page.locator(`.panel.offers [data-withdraw="${pricey}"]`).click();
  await expect(page.locator(`.panel.offers tr[data-offered="${pricey}"]`)).toHaveCount(0);

  // Round one: the CPU teams bid too. The star signs with whoever he liked
  // best, you or one of them, and the round's signings are listed.
  await page.getByRole("button", { name: "Next round" }).click();
  await expect(page.locator(".notice")).toContainText("Round 1:");
  await expect(page.locator(".panel.lastround h2")).toHaveText("Round 1 signings");
  const round = await page.evaluate((pid) => {
    const { state } = window.pokemonNhl;
    const signed = state.fa.last.signed;
    const s = signed.find((x) => x.pid === pid);
    return {
      n: signed.length,
      wars: signed.filter((x) => x.bids > 1).length,
      cpu: signed.filter((x) => x.tid !== state.userTid).length,
      star: s ? { mine: s.tid === state.userTid, tid: state.players[pid].tid, name: state.players[pid].name } : null,
    };
  }, star);
  expect(round.cpu).toBeGreaterThan(0);
  expect(round.wars).toBeGreaterThan(0);
  expect(round.star).not.toBeNull();
  await expect(page.locator(".notice")).toContainText(
    round.star.mine ? `You signed ${round.star.name}` : `You lost ${round.star.name} to`,
  );
  await expect(page.locator(".panel.lastround .signings li").first()).toBeVisible();
  await expect(page.locator(`.panel.offers tr[data-offered="${star}"]`)).toHaveCount(0);

  // The dashboard follows the market, and asks fall each round until it closes.
  await page.getByRole("button", { name: "Dashboard" }).click();
  await expect(page.locator(".evo-alert", { hasText: "Free agency: round 2 of 5" })).toBeVisible();
  for (const r of [2, 3, 4]) {
    await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.locator(".notice")).toContainText(`Round ${r}:`);
  }
  await page.getByRole("button", { name: "Play the last round" }).click();
  await expect(page.locator(".notice")).toContainText("Free agency is over");
  await expect(page.locator(".viewhead h1")).toHaveText("Free agents");

  // Start the second season: the first stays in the history.
  await page.getByRole("button", { name: "Start the 2027 season" }).click();
  await expect(page.locator(".bar-sub")).toContainText("2027");
  await expect(page.locator(".bar-sub")).toContainText("Day 1 of");
  await page.locator(".tab[data-go=history]").click();
  await expect(page.locator("table.history tbody tr")).toHaveCount(1);
  await expect(page.locator("table.history tbody tr").first()).toContainText("2026");

  // The player you re-signed is still yours (unless he retired); the one you
  // let walk is gone, and the news says so.
  const moved = await page.evaluate(
    ([k, w]) => {
      const { state } = window.pokemonNhl;
      const [a, b] = [state.players[k], state.players[w]];
      return { kept: a.tid === state.userTid || a.tid === -2, walked: b.tid !== state.userTid };
    },
    [keep, walk],
  );
  expect(moved.kept).toBe(true);
  expect(moved.walked).toBe(true);
  await page.getByRole("button", { name: "Payroll" }).click();
  await expect(page.locator(".panel h2").first()).toHaveText("2027 season");
  await expect(page.locator(".capbar").first()).toBeVisible();

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

  // It also shows him as an individual Pokémon: level, nature, nickname and
  // his six stats, with IVs only as the in-game judge's words.
  const vet = await page.evaluate((pid) => window.pokemonNhl.state.players[pid], veteran);
  const card = page.locator("#player-body");
  await expect(card).toContainText(`level ${vet.level}`);
  await expect(card).toContainText(`${vet.nature} nature`);
  await expect(card).toContainText(`“${vet.nickname}”`);
  await expect(card.locator(".mon .stat")).toHaveCount(6);
  for (const em of await card.locator(".mon em").allTextContents()) {
    expect(["Best", "Fantastic", "Very good", "Pretty good", "Decent", "No good"]).toContain(em);
  }
  await page.keyboard.press("Escape");

  // Play the second season through, then start the third.
  await page.getByRole("button", { name: "Until the playoffs" }).click();
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe("playoffs");
  await page.getByRole("button", { name: "Until a champion is crowned" }).click();
  await expect.poll(() => phase(page), { timeout: 60_000 }).toBe("done");

  // Two seasons in, players have levelled up and some have evolved. Open an
  // evolved player's card from his team's roster: it shows his new species and
  // where he came from.
  const evolved = await page.evaluate(() => {
    const { state } = window.pokemonNhl;
    const p = state.players.find((x) => x.tid >= 0 && x.evolutions.length);
    const e = p.evolutions.at(-1);
    return { pid: p.pid, tid: p.tid, name: p.name, from: e.from };
  });
  await page.getByRole("button", { name: "Standings" }).click();
  await page.locator(`#app [data-go=team][data-tid="${evolved.tid}"]`).first().click();
  await page.locator(`#app [data-player="${evolved.pid}"]`).first().click();
  await expect(page.locator("#player-body .big")).toContainText(evolved.name);
  await expect(page.locator("#player-body")).toContainText("Evolved from");
  await expect(page.locator("#player-body")).toContainText(/POT \d+/);
  await page.keyboard.press("Escape");

  // If one of your players is waiting on a branching evolution, pick one.
  const waiting = await page.evaluate(() => {
    const { state } = window.pokemonNhl;
    return state.players.find((p) => p.tid === state.userTid && p.evolveChoices)?.pid ?? null;
  });
  if (waiting != null) {
    await page.getByRole("button", { name: "Roster" }).click();
    await page.locator(`#app [data-player="${waiting}"]`).first().click();
    await page.locator("#player-body [data-evolve]").first().click();
    await expect(page.locator(".notice")).toContainText("evolved into");
    await page.keyboard.press("Escape");
  }

  await page.getByRole("button", { name: "Start the 2028 season" }).click();
  await page.getByRole("button", { name: "One week" }).click();
  await expect.poll(() => page.evaluate(() => window.pokemonNhl.state.day), { timeout: 30_000 }).toBe(7);
  await page.locator(".tab[data-go=history]").click();
  await expect(page.locator("table.history tbody tr")).toHaveCount(2);

  // Veterans retired over each summer. The history lists them by summer, and a
  // retired player's card says when he retired and where he last played.
  const retired = page.locator(".panel.retired");
  await expect(retired.locator("[data-retired]")).toHaveCount(2);
  await expect(retired.locator("[data-retired][aria-pressed=true]")).toHaveText("2027");
  await retired.locator('[data-retired="2026"]').click();
  await expect(page.locator(".panel.retired .note").first()).toContainText("after the 2026 season");
  const first = page.locator(".panel.retired tbody [data-player]").first();
  const name = await first.textContent();
  await first.click();
  await expect(page.locator("#player-body .big")).toContainText(name);
  await expect(page.locator("#player-body .eyebrow")).toContainText("Retired after 2026 at");
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});
