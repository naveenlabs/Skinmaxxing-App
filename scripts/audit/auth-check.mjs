// Exercises the account gate and the Account page with Supabase configured but
// unreachable — which is exactly the shape of "signed out, no session". Verifies the
// sign-in screen renders, the guest path works and survives a reload, the Account page
// opens from the header, and the console stays clean throughout.
// Usage: node scripts/audit/auth-check.mjs <outDir>
import { chromium } from "playwright";
import { buildSeed, seedInPage } from "./seed.mjs";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] || "/tmp/glass-auth";
mkdirSync(`${OUT}/shots`, { recursive: true });

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 2 });
let messages = [];
page.on("console", (m) => {
  const t = m.type();
  // A configured-but-fake project can't be reached; network noise isn't a defect here.
  if ((t === "error" || t === "warning") && !/supabase|Failed to fetch|net::ERR/i.test(m.text())) {
    messages.push(`[${t}] ${m.text()}`);
  }
});
page.on("pageerror", (e) => messages.push(`[pageerror] ${e.message}`));

/* ------------------------------- sign-in gate ------------------------------- */

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(seedInPage, buildSeed({ days: 40 }));
// seedInPage marks the device as guest; clear that so the gate is what we're testing.
await page.evaluate(() => localStorage.removeItem("glass:auth-mode"));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1600);

const gate = await page.evaluate(() => document.body.innerText);
check("sign-in screen replaces the app", /Continue with Google/.test(gate));
check("brand line present", /Welcome to/.test(gate) && /Skinmaxxing\./.test(gate));
check("guest escape hatch is offered", /Continue without an account/.test(gate));
check("routine is not reachable behind the gate", !/Good (Morning|Afternoon|Evening)/.test(gate));
await page.screenshot({ path: `${OUT}/shots/auth-signin.png` });
check("console clean (sign-in)", messages.length === 0, messages.join(" | "));

/* --------------------------------- guest path -------------------------------- */

messages = [];
await page.getByText("Continue without an account").click();
await page.waitForTimeout(1500);
const afterGuest = await page.evaluate(() => document.body.innerText);
check("guest lands on the routine", /Good (Morning|Afternoon|Evening)/.test(afterGuest));
check("seeded shelf survived the gate", /COSRX|Anua|Tretinoin/.test(afterGuest));
check("greeting has no leftover hardcoded name", !/Naveen/.test(afterGuest));
await page.screenshot({ path: `${OUT}/shots/auth-guest-routine.png` });

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1400);
const afterReload = await page.evaluate(() => document.body.innerText);
check("guest choice survives a reload", /Good (Morning|Afternoon|Evening)/.test(afterReload));
check("console clean (guest)", messages.length === 0, messages.join(" | "));

/* -------------------------------- account page ------------------------------- */

messages = [];
const accountBtn = page.getByLabel("Your account");
check("header monogram is a real control", await accountBtn.count() > 0);
await accountBtn.first().click();
await page.waitForTimeout(900);

const acct = await page.evaluate(() => document.body.innerText);
check("account page opens", /Account/i.test(acct));
check("guest state is stated plainly", /Not signed in/i.test(acct));
check("guest is invited to sign in", /Sign in to sync/i.test(acct));
check("guest is offered a way out of guest mode", /Exit guest mode/i.test(acct));
check("preferences present", /Display name/i.test(acct) && /Export your data/i.test(acct));
check("storage section present", /Storage/i.test(acct));
check("destructive action present", /Delete everything/i.test(acct));
check("sign out hidden for a guest", !/Sign out/i.test(acct));
const stats = await page.evaluate(() =>
  [...document.querySelectorAll(".u-eyebrow")].map((e) => e.textContent.trim()));
check("stat row rendered", stats.includes("Days") && stats.includes("Streak") && stats.includes("Completion"));
check("tab bar hidden behind the account page", await page.locator("nav button").count() === 0);
await page.screenshot({ path: `${OUT}/shots/auth-account.png` });
await page.evaluate(() => {
  const el = document.querySelector('[role="dialog"][aria-label="Your account"]');
  if (el) el.scrollTop = el.scrollHeight;
});
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/shots/auth-account-bottom.png` });
check("console clean (account)", messages.length === 0, messages.join(" | "));

/* ------------------------------- display name -------------------------------- */

messages = [];
await page.evaluate(() => {
  const el = document.querySelector('[role="dialog"][aria-label="Your account"]');
  if (el) el.scrollTop = 0;
});
await page.waitForTimeout(300);
await page.getByText("Display name", { exact: true }).click();
await page.waitForTimeout(700);
await page.getByLabel("Display name").fill("Naveen");
await page.getByText("Save", { exact: true }).click();
await page.waitForTimeout(700);
await page.getByLabel("Back").click();
await page.waitForTimeout(900);
const named = await page.evaluate(() => document.body.innerText);
check("chosen name drives the greeting", /Naveen\./.test(named));
const mono = await page.getByLabel("Your account").first().innerText();
check("monogram follows the name", mono.trim() === "N", mono);
await page.screenshot({ path: `${OUT}/shots/auth-named.png` });
check("console clean (display name)", messages.length === 0, messages.join(" | "));

/* ------------------------------- data intact --------------------------------- */

messages = [];
await page.locator("nav button", { hasText: /^Shelf$/i }).first().click();
await page.waitForTimeout(800);
const shelf = await page.evaluate(() => document.body.innerText);
check("shelf still renders seeded products", /COSRX/.test(shelf));
check("console clean (navigation)", messages.length === 0, messages.join(" | "));

/* ------------------------------- signed-in UI -------------------------------- */
// A real Google round trip can't run headless, but the UI downstream of it can: plant
// a live session in the client's own storage key and let the app boot from it. The
// fake project is unreachable, so this also exercises the "couldn't sync" state.

messages = [];
await page.evaluate(() => {
  const user = {
    id: "11111111-2222-3333-4444-555555555555",
    aud: "authenticated",
    role: "authenticated",
    email: "naveen@example.com",
    created_at: "2026-02-14T10:00:00Z",
    user_metadata: {
      full_name: "Virat Naveen",
      given_name: "Naveen",
      email: "naveen@example.com",
      avatar_url: "",
    },
  };
  localStorage.setItem("glass:sb-auth", JSON.stringify({
    access_token: "fake.access.token",
    token_type: "bearer",
    expires_in: 999999,
    expires_at: Math.floor(Date.now() / 1000) + 999999,
    refresh_token: "fake-refresh",
    user,
  }));
  localStorage.removeItem("glass:auth-mode");
});
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const signedIn = await page.evaluate(() => document.body.innerText);
check("session boots straight into the routine", /Good (Morning|Afternoon|Evening)/.test(signedIn));
check("greeting uses the Google given name", /Naveen\./.test(signedIn));

await page.getByLabel("Your account").first().click();
await page.waitForTimeout(1200);
const acct2 = await page.evaluate(() => document.body.innerText);
check("account shows the real name", /Virat Naveen|Naveen/.test(acct2));
check("account shows the email", /naveen@example\.com/.test(acct2));
check("member-since reflects the account", /Since February 2026/i.test(acct2), acct2.match(/Since [^\n]*/)?.[0] || "");
check("sign out is offered when signed in", /Sign out/i.test(acct2));
check("guest copy is gone", !/Not signed in/i.test(acct2));
check("signed-in user is never offered a second sign-in", !/Sign in to sync/i.test(acct2));
check("signed-in user is not offered guest controls", !/Exit guest mode/i.test(acct2));
check("unreachable project surfaces an honest sync state",
  /Couldn't sync|Syncing|Offline|Ready to sync|synced/i.test(acct2));
await page.screenshot({ path: `${OUT}/shots/auth-signed-in.png` });
check("console clean (signed in)", messages.length === 0, messages.join(" | "));

console.log(`\n===== ${pass} passed, ${fail} failed =====\n`);
await browser.close();
process.exit(fail ? 1 : 0);
