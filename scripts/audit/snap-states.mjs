// Screenshots the states that are easy to miss: empty data, every sheet, the kebab menu.
import { boot, go, scrollRoot } from "./drive.mjs";

const OUT = process.argv[2];

// ---- empty everything ----
{
  const { browser, page, messages } = await boot({ empty: true });
  for (const t of ["ROUTINE", "SHELF", "INSIGHTS", "JOURNEY"]) {
    await go(page, t);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/empty-${t.toLowerCase()}.png` });
    await scrollRoot(page, 700);
    await page.screenshot({ path: `${OUT}/empty-${t.toLowerCase()}-2.png` });
    await scrollRoot(page, 0);
  }
  console.log("empty console:", messages.join(" | ") || "(clean)");
  await browser.close();
}

// ---- sheets ----
{
  const { browser, page, messages } = await boot({ days: 150 });

  await go(page, "ROUTINE");
  await scrollRoot(page, 1500);
  await page.getByText(/Felt |How did your skin feel/).first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/sheet-mood.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  await go(page, "SHELF");
  await page.getByText("Add a product").click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/sheet-editor.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('[role="dialog"]').evaluate((d) => d.scrollTo(0, d.scrollHeight));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/sheet-editor-bottom.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // kebab menu
  await page.locator("button:has(svg.lucide-ellipsis)").first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/kebab.png` });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const ov = [...document.querySelectorAll("div")].find((d) => d.style.zIndex === "140");
    if (ov) ov.click();
  });
  await page.waitForTimeout(400);

  // retire flow
  await page.locator("button:has(svg.lucide-ellipsis)").first().click();
  await page.waitForTimeout(400);
  await page.getByRole("menuitem", { name: "Retire" }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/sheet-retire.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  await go(page, "INSIGHTS");
  await page.getByText("Export", { exact: true }).first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/sheet-export.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // product history calendar
  await scrollRoot(page, 3000);
  const hist = page.locator("button", { hasText: /last used|not used yet/ }).first();
  if (await hist.count()) {
    await hist.click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/sheet-history.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  // journey: picker + year view + cleanup confirm
  await go(page, "JOURNEY");
  await page.getByText("Compare", { exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.locator('[data-testid="compare-A"]').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/sheet-picker.png` });
  await page.getByText("All photos").click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/sheet-picker-all.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  await page.getByText("vs 90 days").click();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: `${OUT}/compare-filled.png` });

  await page.getByText("Gallery", { exact: true }).click();
  await page.waitForTimeout(500);
  await page.getByText(/^Clean up 90\+ days/).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/sheet-cleanup.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);

  await page.getByText(/Year view/).click();
  await page.waitForTimeout(800);
  await scrollRoot(page, 1600);
  await page.screenshot({ path: `${OUT}/journey-year.png` });

  // lightbox
  await scrollRoot(page, 900);
  await page.locator('[data-testid="lazy-photo"]').first().click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/lightbox.png` });

  console.log("sheets console:", messages.join(" | ") || "(clean)");
  await browser.close();
}
