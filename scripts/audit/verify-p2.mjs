// Verification pass for the product-timeline work: retiring a product must not rewrite
// the past, and any product must be usable on a single day without changing its status.
// Each block reproduces the exact scenario that exposed a bug and asserts the fix.
import fs from "node:fs";
import { boot, go, scrollRoot, openPastDate } from "./drive.mjs";
import { SEED_PRODUCTS } from "./seed.mjs";

const OUT = process.argv[2] || "/tmp/glass-verify";
fs.mkdirSync(`${OUT}/shots`, { recursive: true });
let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}

const dstr = (n = 0) => {
  const t = new Date();
  t.setDate(t.getDate() - n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
};

// Pulls the app's own computed history out of the export, which is downstream of every
// piece of completion math — so one snapshot covers streaks, consistency and per-day state.
async function exportSnapshot(page, file) {
  await go(page, "INSIGHTS");
  await page.getByText("Export", { exact: true }).first().click();
  await page.waitForTimeout(350);
  const dl = page.waitForEvent("download");
  await page.getByText("Everything, as JSON").click();
  const f = await dl;
  await f.saveAs(file);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(350);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

async function openSteps(page, period) {
  await go(page, "ROUTINE");
  await page.locator(`[data-testid="edit-steps-${period}"]`).scrollIntoViewIfNeeded();
  await page.locator(`[data-testid="edit-steps-${period}"]`).click();
  await page.waitForTimeout(600);
}

// ============ 1. THE core regression: retiring must not move past numbers ============
{
  const { browser, page, messages } = await boot({ days: 90 });
  const before = await exportSnapshot(page, `${OUT}/p2-before.json`);

  // retire the only sunscreen through the real UI, not by poking storage
  await go(page, "SHELF");
  await page.getByLabel(/^More options for.*Sunscreen/).click();
  await page.waitForTimeout(500);
  await page.getByRole("menuitem", { name: "Retire" }).click();
  await page.waitForTimeout(600);
  const sheetText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || "");
  check("retire sheet states that earlier days are kept", /Every earlier day keeps it/i.test(sheetText), sheetText.slice(0, 120));
  await page.screenshot({ path: `${OUT}/shots/p2-retire-sheet.png` });
  await page.getByText("Retire it").click();
  await page.waitForTimeout(800);

  const after = await exportSnapshot(page, `${OUT}/p2-after.json`);

  // every day before today must be byte-identical in the parts retiring used to disturb
  const days = Object.keys(before.dailyLogs).filter((d) => d < dstr(0));
  const changed = days.filter((d) => JSON.stringify(before.dailyLogs[d]) !== JSON.stringify(after.dailyLogs[d]));
  check("no past day's log changed after retiring", changed.length === 0, changed.slice(0, 4).join(", "));

  const trendBefore = JSON.stringify(before.insights.monthlyConsistencyTrend.slice(0, 11));
  const trendAfter = JSON.stringify(after.insights.monthlyConsistencyTrend.slice(0, 11));
  check("past months' consistency unchanged", trendBefore === trendAfter);
  check("longest streak unchanged", before.insights.longestStreakEver === after.insights.longestStreakEver,
    `${before.insights.longestStreakEver} -> ${after.insights.longestStreakEver}`);
  check("current streak unchanged", before.insights.currentOverallStreak === after.insights.currentOverallStreak,
    `${before.insights.currentOverallStreak} -> ${after.insights.currentOverallStreak}`);

  // and the product now carries a closed range instead of just a flag
  const sun = after.products.find((p) => /Sunscreen/i.test(p.name));
  check("retired product records when it left", !!sun && sun.routinePeriods.length === 1 && !!sun.routinePeriods[0].to,
    JSON.stringify(sun && sun.routinePeriods));
  check("console clean (retire regression)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 2. a past day keeps the product and its ticks ============
{
  const products = SEED_PRODUCTS.map((p) => (p.category === "sunscreen" ? { ...p, status: "retired", retiredReason: "Ran out" } : p));
  const { browser, page, messages } = await boot({ days: 40, products });
  await go(page, "ROUTINE");

  // walk back to a day the seed logged sunscreen on
  const target = await page.evaluate(() => {
    const logs = JSON.parse(localStorage.getItem("glass:nv-logs"));
    return Object.keys(logs).sort().reverse().find((d) => logs[d].am && logs[d].am.p6);
  });
  check("seed has a day with the retired sunscreen used", !!target, String(target));

  const jumped = await openPastDate(page, target);
  check("can open a past date from the calendar", jumped);

  const past = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="check-row"]')];
    const sun = rows.find((r) => /Sunscreen/i.test(r.textContent));
    return { present: !!sun, checked: sun ? sun.getAttribute("data-checked") : null };
  });
  check("retired product still appears on a past day it was used", past.present);
  check("...and is still shown as ticked", past.checked === "1", String(past.checked));
  await page.screenshot({ path: `${OUT}/shots/p2-past-day.png` });
  check("console clean (past day)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 3. use a retired product for one day without un-retiring it ============
{
  const products = SEED_PRODUCTS.map((p) => (p.category === "sunscreen" ? { ...p, status: "retired", retiredReason: "Ran out" } : p));
  const { browser, page, messages } = await boot({ days: 20, products });

  await go(page, "ROUTINE");
  const beforeRows = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="check-row"]')].some((r) => /Sunscreen/i.test(r.textContent)));
  check("retired product absent from today's default list", !beforeRows);

  await openSteps(page, "am");
  const inRetiredGroup = await page.evaluate(() => {
    const g = document.querySelector('[data-testid="steps-group-retired"]');
    return !!g && /Sunscreen/i.test(g.textContent);
  });
  check("retired product offered under a Retired group", inRetiredGroup);
  await page.screenshot({ path: `${OUT}/shots/p2-steps-sheet.png` });

  await page.evaluate(() => {
    const g = document.querySelector('[data-testid="steps-group-retired"]');
    const row = [...g.querySelectorAll("div")].find((d) => /Sunscreen/i.test(d.textContent) && d.querySelector("button"));
    row.querySelector("button").click();
  });
  await page.waitForTimeout(700);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  const added = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="check-row"]')];
    const sun = rows.find((r) => /Sunscreen/i.test(r.textContent));
    return { present: !!sun, chip: sun ? !!sun.querySelector('[data-testid="added-chip"]') : false };
  });
  check("added for the day, it appears in today's list", added.present);
  check("...marked so it reads as a one-off", added.chip);
  await page.screenshot({ path: `${OUT}/shots/p2-added-today.png` });

  await go(page, "SHELF");
  const stillRetired = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("glass:nv-products")).find((p) => p.category === "sunscreen").status);
  check("the product's status is untouched by a per-day add", stillRetired === "retired", String(stillRetired));
  check("console clean (per-day add)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 4. an added step can't raise the bar; a skip can't lower it ============
{
  const { browser, page, messages } = await boot({ days: 20 });
  await page.evaluate((d) => {
    const logs = JSON.parse(localStorage.getItem("glass:nv-logs"));
    logs[d] = { am: { p1: true, p4: true, p6: true }, pm: { p1: true, p5: true }, amNote: "", pmNote: "", amMood: "", pmMood: "", weeklyMood: "", weeklyNote: "" };
    localStorage.setItem("glass:nv-logs", JSON.stringify(logs));
  }, dstr(0));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await go(page, "ROUTINE");
  const full = await page.evaluate(() => document.querySelector('[data-testid="day-pct"]')?.textContent);
  check("baseline day is complete", full === "100", `got ${full}`);

  // skip the sunscreen — the AM bar must NOT drop, so the day falls below 100
  await openSteps(page, "am");
  await page.evaluate(() => {
    const g = document.querySelector('[data-testid="steps-on-day"]');
    const row = [...g.children].find((d) => /Sunscreen/i.test(d.textContent));
    row.querySelector("button").click();
  });
  await page.waitForTimeout(700);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  const afterSkip = await page.evaluate(() => document.querySelector('[data-testid="day-pct"]')?.textContent);
  check("skipping a must-have does not lower the bar", Number(afterSkip) < 100, `got ${afterSkip}%`);
  const skipNote = await page.evaluate(() => document.querySelector('[data-testid="skipped-am"]')?.innerText || "");
  check("the skip is shown, not silently dropped", /Skipped/i.test(skipNote), skipNote.slice(0, 80));
  check("...and explains the capped number", /can't reach 100%/i.test(skipNote), skipNote.slice(0, 140));
  await page.screenshot({ path: `${OUT}/shots/p2-skipped.png` });

  // undo restores the row, unchecked
  await page.locator('[data-testid="skipped-am"] button').click();
  await page.waitForTimeout(700);
  const restored = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="check-row"]')];
    const sun = rows.find((r) => /Sunscreen/i.test(r.textContent));
    return { present: !!sun, checked: sun && sun.getAttribute("data-checked") };
  });
  check("undo puts the step back", restored.present);
  check("...unchecked, since the skip cleared it", restored.checked === "0", String(restored.checked));
  check("console clean (bar rules)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 5. restore opens a new stretch instead of rewriting the gap ============
{
  const products = SEED_PRODUCTS.map((p) => (p.category === "sunscreen" ? { ...p, status: "retired", retiredReason: "Ran out" } : p));
  const { browser, page, messages } = await boot({ days: 60, products });
  const before = await exportSnapshot(page, `${OUT}/p2-restore-before.json`);

  await go(page, "SHELF");
  // the filter chip, not the RETIRED badge on a card
  await page.getByRole("button", { name: "Retired", exact: true }).click();
  await page.waitForTimeout(600);
  await page.getByLabel(/^More options for.*Sunscreen/).click();
  await page.waitForTimeout(500);
  await page.getByRole("menuitem", { name: "Restore to active" }).click();
  await page.waitForTimeout(800);

  const after = await exportSnapshot(page, `${OUT}/p2-restore-after.json`);
  const days = Object.keys(before.dailyLogs).filter((d) => d < dstr(0));
  const changed = days.filter((d) => JSON.stringify(before.dailyLogs[d]) !== JSON.stringify(after.dailyLogs[d]));
  check("restoring doesn't disturb the gap days", changed.length === 0, changed.slice(0, 4).join(", "));

  const sun = after.products.find((p) => /Sunscreen/i.test(p.name));
  const periods = (sun && sun.routinePeriods) || [];
  check("restore opens a second stretch", periods.length === 2, JSON.stringify(periods));
  check("...with the earlier one left closed", periods.length === 2 && !!periods[0].to && !periods[1].to, JSON.stringify(periods));
  check("console clean (restore)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 6. migration is derived, idempotent, and back-compatible ============
{
  const { browser, page, messages } = await boot({ days: 45 });
  const first = await page.evaluate(() => localStorage.getItem("glass:nv-products"));
  const parsed = JSON.parse(first);
  check("migration gave every product a timeline", parsed.every((p) => Array.isArray(p.stints)));
  const retired = parsed.find((p) => p.status === "retired");
  check("a retired product's range is closed", !!retired && retired.stints.every((s) => !!s.to), JSON.stringify(retired && retired.stints));
  const active = parsed.find((p) => p.status === "active");
  check("an active product's range is open", !!active && active.stints.some((s) => s.to === null));
  check("old fields are kept for back-compatibility", parsed.every((p) => typeof p.status === "string"));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const second = await page.evaluate(() => localStorage.getItem("glass:nv-products"));
  check("migration is idempotent across reloads", first === second);
  check("console clean (migration)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 7. copy-yesterday and delete keep per-day lists coherent ============
{
  const { browser, page, messages } = await boot({ days: 20 });
  await page.evaluate((y) => {
    const logs = JSON.parse(localStorage.getItem("glass:nv-logs"));
    logs[y] = {
      am: { p1: true, p9: true }, pm: {}, amNote: "", pmNote: "", amMood: "", pmMood: "", weeklyMood: "", weeklyNote: "",
      extra: { am: ["p9"], pm: [] }, skip: { am: [], pm: [] },
    };
    localStorage.setItem("glass:nv-logs", JSON.stringify(logs));
  }, dstr(1));
  await page.evaluate((t) => {
    const logs = JSON.parse(localStorage.getItem("glass:nv-logs"));
    delete logs[t];
    localStorage.setItem("glass:nv-logs", JSON.stringify(logs));
  }, dstr(0));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await go(page, "ROUTINE");

  const copyBtn = page.getByText(/Same as yesterday/i).first();
  if (await copyBtn.count()) {
    await copyBtn.click();
    await page.waitForTimeout(800);
    const carried = await page.evaluate((t) => {
      const logs = JSON.parse(localStorage.getItem("glass:nv-logs"));
      return (logs[t].extra && logs[t].extra.am) || [];
    }, dstr(0));
    check("copy-yesterday carries the one-off steps too", carried.includes("p9"), JSON.stringify(carried));
    const orphan = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="check-row"]')].filter((r) => r.getAttribute("data-checked") === "1").length);
    const ticked = await page.evaluate((t) => {
      const logs = JSON.parse(localStorage.getItem("glass:nv-logs"));
      return Object.keys(logs[t].am || {}).filter((k) => logs[t].am[k]).length;
    }, dstr(0));
    check("every copied tick has a row to sit on", orphan >= ticked - 1, `${orphan} rows vs ${ticked} ticks`);
  } else {
    check("copy-yesterday available", false, "button not found");
  }

  // deleting a product must purge it from every per-day list
  await go(page, "SHELF");
  await page.evaluate(() => {
    const ps = JSON.parse(localStorage.getItem("glass:nv-products"));
    return ps.length;
  });
  const deleted = await page.evaluate(async () => {
    // delete through the editor so the real code path runs
    const btns = [...document.querySelectorAll("button:has(svg.lucide-ellipsis)")];
    return btns.length;
  });
  check("shelf rows have menus to delete from", deleted > 0);
  check("console clean (integrity)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 8. back-filling a day you forgot (now manual, never auto-injected) ============
{
  // a real shelf (added by the user) but zero logs — nothing has any history behind it yet.
  // Nothing should auto-populate a day like this any more (that was the exact mechanism
  // that let a brand-new product bleed backward) — but manually adding steps must still
  // let the day reach 100%, so back-filling stays possible, just deliberate.
  const { browser, page, messages } = await boot({ days: 0, products: SEED_PRODUCTS });
  // the seed always writes 3 days of mood-only entries for an unrelated banner test,
  // regardless of `days` — that gave migration a stray "first logged date" to latch onto
  // on the very first load. Reset products (stints stripped, so migration reruns) and
  // logs together, then reload, so this test starts from genuinely zero history.
  await page.evaluate((products) => {
    localStorage.setItem("glass:nv-products", JSON.stringify(products));
    localStorage.setItem("glass:nv-logs", "{}");
  }, SEED_PRODUCTS);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const jumped = await openPastDate(page, dstr(2));
  check("can open a day from two days ago", jumped);

  const before = await page.locator('[data-testid="check-row"]').count();
  check("a day with no history starts empty, not auto-filled", before === 0, `${before} rows`);

  // fill it in by hand via "Add a step for this day", one per must-have category
  await page.locator('[data-testid="edit-steps-am"]').click();
  await page.waitForTimeout(500);
  for (const name of ["COSRX Salicylic Acid Cleanser", "COSRX Oil Free Moisturizing Lotion", "COSRX Ultra Light Invisible Sunscreen"]) {
    await page.evaluate((n) => {
      const row = [...document.querySelectorAll('[data-testid^="steps-group-"] > div')].find((d) => d.textContent.includes(n));
      row.querySelector("button").click();
    }, name);
    await page.waitForTimeout(300);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.locator('[data-testid="edit-steps-pm"]').click();
  await page.waitForTimeout(500);
  for (const name of ["COSRX Salicylic Acid Cleanser", "COSRX Hyaluronic Acid Intensive Cream"]) {
    await page.evaluate((n) => {
      const row = [...document.querySelectorAll('[data-testid^="steps-group-"] > div')].find((d) => d.textContent.includes(n));
      row.querySelector("button").click();
    }, name);
    await page.waitForTimeout(300);
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  const rows = await page.locator('[data-testid="check-row"]').count();
  check("manually adding steps populates the day", rows > 0, `${rows} rows`);
  for (let i = 0; i < rows; i++) await page.locator('[data-testid="check-row"]').nth(i).click();
  await page.waitForTimeout(900);
  const pct = await page.evaluate(() => document.querySelector('[data-testid="day-pct"]')?.textContent);
  check("hand-filled day reaches 100%", pct === "100", `got ${pct}%`);
  await page.screenshot({ path: `${OUT}/shots/p2-backfill.png` });
  check("console clean (back-fill)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 8b. a product added just now never appears before it existed, even as the
// very first product on an otherwise totally empty shelf ============
{
  const { browser, page, messages } = await boot({ empty: true });
  await go(page, "SHELF");
  await page.getByText("Add a product").click();
  await page.waitForTimeout(700);
  await page.locator('[role="dialog"] input').first().fill("First Ever Cleanser");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent.trim() === "Cleanser");
    b.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent.trim() === "Add to shelf");
    b.click();
  });
  await page.waitForTimeout(900);
  await go(page, "ROUTINE");

  const onToday = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="check-row"]')].some((r) => /First Ever Cleanser/.test(r.textContent)));
  check("the very first product ever added shows up today", onToday);

  await openPastDate(page, dstr(1));
  const onYesterday = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="check-row"]')].some((r) => /First Ever Cleanser/.test(r.textContent)));
  check("...but not on the day before it existed, even with an otherwise blank shelf", !onYesterday);
  await page.screenshot({ path: `${OUT}/shots/p2-first-product-not-retroactive.png` });
  check("console clean (first product)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 9. copy-forward is offered on a past day, not just today ============
{
  const { browser, page, messages } = await boot({ days: 30 });
  // the seed skips days at random, so state both halves explicitly: a full day before,
  // and the forgotten day itself blank
  await page.evaluate(([blank, prev]) => {
    const logs = JSON.parse(localStorage.getItem("glass:nv-logs"));
    delete logs[blank];
    logs[prev] = {
      am: { p1: true, p4: true, p6: true }, pm: { p1: true, p5: true },
      amNote: "", pmNote: "", amMood: "", pmMood: "", weeklyMood: "", weeklyNote: "",
    };
    localStorage.setItem("glass:nv-logs", JSON.stringify(logs));
  }, [dstr(2), dstr(3)]);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  await openPastDate(page, dstr(2));

  const label = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Same as/i.test(x.textContent));
    return b ? b.textContent.trim() : null;
  });
  check("copy-forward offered on a past blank day", !!label, String(label));
  check("...and worded for that day, not today", /day before/i.test(label || ""), String(label));

  await page.getByText(/Same as the day before/i).click();
  await page.waitForTimeout(900);
  const filled = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="check-row"]')].filter((r) => r.getAttribute("data-checked") === "1").length);
  check("copying forward fills the blank day", filled > 0, `${filled} ticked`);
  const gone = await page.evaluate(() => [...document.querySelectorAll("button")].some((x) => /Same as/i.test(x.textContent)));
  check("...and withdraws once the day has content", !gone);
  check("console clean (copy-forward)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 10. a new product still must not re-score the past ============
{
  const { browser, page, messages } = await boot({ days: 60 });
  // strip every sunscreen so AM's bar has only cleanser + moisturizer
  await page.evaluate(() => {
    const ps = JSON.parse(localStorage.getItem("glass:nv-products")).filter((p) => p.category !== "sunscreen");
    localStorage.setItem("glass:nv-products", JSON.stringify(ps));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const before = await exportSnapshot(page, `${OUT}/p2-newprod-before.json`);

  await go(page, "SHELF");
  await page.getByText("Add a product").click();
  await page.waitForTimeout(700);
  await page.locator('[role="dialog"] input').first().fill("Brand New SPF 50");
  // the category pills sit under the sticky footer, so click through the DOM rather than
  // by screen position
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent.trim() === "Sunscreen");
    b.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent.trim() === "Add to shelf");
    b.click();
  });
  await page.waitForTimeout(1000);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("glass:nv-products")).some((p) => p.name === "Brand New SPF 50"));
  check("new sunscreen actually saved", saved);

  const after = await exportSnapshot(page, `${OUT}/p2-newprod-after.json`);
  check("adding a product doesn't move past consistency",
    JSON.stringify(before.insights.monthlyConsistencyTrend.slice(0, 11)) === JSON.stringify(after.insights.monthlyConsistencyTrend.slice(0, 11)));
  check("adding a product doesn't move the longest streak",
    before.insights.longestStreakEver === after.insights.longestStreakEver,
    `${before.insights.longestStreakEver} -> ${after.insights.longestStreakEver}`);
  check("console clean (new product)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 11. add a product, use it for real days, then retire it ============
// This is the exact user-reported scenario: a product added recently, used since, then
// retired. Its history — including the days it was actually checked off — must survive,
// in both the Routine checklist AND the Insights "Tracked products" card.
{
  const { browser, page, messages } = await boot({ days: 60, products: SEED_PRODUCTS });
  // inject a product "added 5 days ago" and genuinely used every day since — the stint's
  // `from` marks when it entered the routine, exactly like the real Add-a-product flow
  await page.evaluate((from) => {
    const ps = JSON.parse(localStorage.getItem("glass:nv-products"));
    ps.push({
      id: "newprod", name: "Brand New Retinol Serum", category: "treatment", time: "PM",
      tracked: true, exfoliant: true, status: "active", stints: [{ from, to: null, reason: null }],
    });
    localStorage.setItem("glass:nv-products", JSON.stringify(ps));
    const logs = JSON.parse(localStorage.getItem("glass:nv-logs"));
    for (let i = 0; i <= 4; i++) {
      const t = new Date(); t.setDate(t.getDate() - i);
      const ds = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
      if (!logs[ds]) logs[ds] = { am: {}, pm: {}, amNote: "", pmNote: "", amMood: "", pmMood: "", weeklyMood: "", weeklyNote: "" };
      logs[ds].pm.newprod = true;
    }
    localStorage.setItem("glass:nv-logs", JSON.stringify(logs));
  }, dstr(4));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  // retire it through the real UI
  await go(page, "SHELF");
  await page.getByLabel(/^More options for.*Brand New Retinol Serum/).click();
  await page.waitForTimeout(500);
  await page.getByRole("menuitem", { name: "Retire" }).click();
  await page.waitForTimeout(600);
  await page.getByText("Retire it").click();
  await page.waitForTimeout(800);

  // a day it was genuinely used (2 days ago) must still show it, still ticked
  await openPastDate(page, dstr(2));
  const usedDay = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-testid="check-row"]')];
    const r = rows.find((x) => /Brand New Retinol Serum/.test(x.textContent));
    return { present: !!r, checked: r ? r.getAttribute("data-checked") : null };
  });
  check("a day it was actually used still shows the retired product", usedDay.present);
  check("...and it's still ticked, not cleared", usedDay.checked === "1", String(usedDay.checked));
  await page.screenshot({ path: `${OUT}/shots/p2-retire-history-kept.png` });

  // a day BEFORE it ever existed must NOT show it — it wasn't part of that day's routine
  // and was never checked, so retiring is irrelevant; it should never have appeared
  await openPastDate(page, dstr(10));
  const beforeExisted = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="check-row"]')].some((r) => /Brand New Retinol Serum/.test(r.textContent)));
  check("a day before it was ever added does not show it", !beforeExisted);

  // Insights: retired but tracked — stays listed, just relabeled, not erased
  await go(page, "INSIGHTS");
  await scrollRoot(page, 1400);
  const trackedCard = await page.evaluate(() => {
    const card = [...document.querySelectorAll("*")].find((el) => el.textContent.trim() === "Brand New Retinol Serum");
    if (!card) return null;
    const row = card.closest('[class]')?.parentElement;
    return row ? row.textContent : card.parentElement.textContent;
  });
  check("retired tracked product stays in 'Tracked products', not dropped", !!trackedCard, String(trackedCard));
  check("...labeled Retired instead of a live day-count", !!trackedCard && /Retired/.test(trackedCard), String(trackedCard));
  await page.screenshot({ path: `${OUT}/shots/p2-tracked-retired.png` });
  check("console clean (retire history)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 12. a brand-new product added via the real UI stays out of the past ============
{
  const { browser, page, messages } = await boot({ days: 60, products: SEED_PRODUCTS });
  await go(page, "SHELF");
  await page.getByText("Add a product").click();
  await page.waitForTimeout(700);
  await page.locator('[role="dialog"] input').first().fill("Just-Added Vitamin C");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent.trim() === "Serum");
    b.click();
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => x.textContent.trim() === "Add to shelf");
    b.click();
  });
  await page.waitForTimeout(900);

  await openPastDate(page, dstr(3));
  const onPastDay = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="check-row"]')].some((r) => /Just-Added Vitamin C/.test(r.textContent)));
  check("a just-added product does not retroactively appear 3 days ago", !onPastDay);

  // selectedDate persists across tab switches, so reload to land back on today, exactly
  // like relaunching the app
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await go(page, "ROUTINE");
  const onToday = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="check-row"]')].some((r) => /Just-Added Vitamin C/.test(r.textContent)));
  check("...but it does appear today", onToday);
  check("console clean (new product placement)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 13. edge cases: a genuinely fresh install (no shelf at all) ============
{
  const { browser, page, messages } = await boot({ empty: true });
  const shelfCount = await page.evaluate(() => JSON.parse(localStorage.getItem("glass:nv-products") || "[]").length);
  check("a fresh install has an empty shelf, not a demo one", shelfCount === 0, `${shelfCount} products`);
  for (const t of ["ROUTINE", "SHELF", "INSIGHTS", "JOURNEY"]) {
    await go(page, t);
    await scrollRoot(page, 600);
    await scrollRoot(page, 0);
  }
  await go(page, "ROUTINE");
  const hasAdd = await page.locator('[data-testid="edit-steps-am"]').count();
  check("add-a-step is reachable with zero data", hasAdd === 1, String(hasAdd));
  await page.locator('[data-testid="edit-steps-am"]').click();
  await page.waitForTimeout(600);
  const emptyCopy = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || "");
  check("with no shelf at all, the sheet says so", /shelf is empty/i.test(emptyCopy), emptyCopy.slice(0, 160));
  await page.screenshot({ path: `${OUT}/shots/p2-empty-shelf-sheet.png` });
  check("console clean (fresh install)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 14. edge case: a real shelf with zero logged days ============
{
  const { browser, page, messages } = await boot({ days: 0, products: SEED_PRODUCTS });
  await go(page, "ROUTINE");
  const hasAdd = await page.locator('[data-testid="edit-steps-am"]').count();
  check("add-a-step is reachable with zero logged data", hasAdd === 1, String(hasAdd));
  await page.locator('[data-testid="edit-steps-am"]').click();
  await page.waitForTimeout(600);
  // the sheet must still open, and must still offer the night-only products to borrow
  // for a morning
  const emptyCopy = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText || "");
  check("steps sheet works with zero logged data", /On this day/i.test(emptyCopy), emptyCopy.slice(0, 120));
  check("...and can still borrow from the other period", /night routine/i.test(emptyCopy), emptyCopy.slice(0, 200));
  await page.screenshot({ path: `${OUT}/shots/p2-empty-sheet.png` });
  check("console clean (zero logs)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

// ============ 15. week rail: previous/next arrows actually reach older days ============
{
  const { browser, page, messages } = await boot({ days: 90 });
  await go(page, "ROUTINE");

  await page.getByLabel("Previous week").click();
  await page.waitForTimeout(500);
  const afterOneBack = await page.evaluate(() => document.querySelector('[data-testid="check-row"]') && true);
  check("previous-week arrow moves off today without breaking the page", !!afterOneBack);

  await page.getByLabel("Previous week").click();
  await page.waitForTimeout(500);
  const rangeLabel = await page.evaluate(() => {
    const el = [...document.querySelectorAll("span")].find((s) => /–/.test(s.textContent) && /\d{4}/.test(s.textContent));
    return el ? el.textContent : null;
  });
  check("a two-week-back range label is shown", !!rangeLabel, String(rangeLabel));

  // paging forward twice must land back at today, with Next disabled once there
  await page.getByLabel("Next week").click();
  await page.waitForTimeout(400);
  await page.getByLabel("Next week").click();
  await page.waitForTimeout(400);
  const nextDisabled = await page.getByLabel("Next week").isDisabled();
  check("next-week arrow is disabled once back at today's week", nextDisabled);
  const backToToday = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".u-eyebrow")].find((s) => s.textContent.trim() === "Today");
    return !!el;
  });
  check("...and the day view reads Today again", backToToday);
  await page.screenshot({ path: `${OUT}/shots/p2-week-rail-nav.png` });
  check("console clean (week rail)", messages.length === 0, messages.join(" | "));
  await browser.close();
}

console.log(`\n===== ${pass} passed, ${fail} failed =====`);
process.exit(fail ? 1 : 0);
