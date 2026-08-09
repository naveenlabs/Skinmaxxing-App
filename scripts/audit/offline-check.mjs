// Offline must never lock a signed-in user out of their own data.
//
// Access tokens expire after an hour. The original code discarded getSession()'s error,
// so opening the app offline after that hour returned no session, fell through to
// "signed-out", and showed a sign-in wall — with the user's entire routine sitting
// unreachable in `glass:u_<uid>:*`. Worse, tapping "Continue without an account" then
// pinned the device to the guest namespace for good.
//
// Supabase is blocked at the network layer rather than using context.setOffline, because
// the app itself is served over the same localhost connection.
//
// Usage: node scripts/audit/offline-check.mjs <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] || "/tmp/glass-offline";
mkdirSync(`${OUT}/shots`, { recursive: true });

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}

const U = { id: "cccccccc-3333-3333-3333-333333333333", email: "cass@example.com", name: "Cass" };
const MARK = "OFFLINE_ONLY_SERUM";

const b64url = (o) =>
  Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const session = (expiresInSeconds) => {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  return {
    access_token: [
      b64url({ alg: "HS256", typ: "JWT" }),
      b64url({ sub: U.id, email: U.email, aud: "authenticated", role: "authenticated", exp }),
      "sig",
    ].join("."),
    token_type: "bearer",
    expires_in: expiresInSeconds,
    expires_at: exp,
    refresh_token: `fake-refresh-${U.id}`,
    user: {
      id: U.id, aud: "authenticated", role: "authenticated", email: U.email,
      created_at: "2026-02-14T10:00:00Z",
      user_metadata: { full_name: U.name, given_name: U.name, email: U.email },
    },
  };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

let supabaseReachable = true;
await page.route("**://*.supabase.co/**", (route) => {
  if (!supabaseReachable) return route.abort("internetdisconnected");
  return route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: "[]" });
});

const bodyText = () => page.evaluate(() => document.body.innerText);

/* --------- 1. signed in, token already expired, network unreachable --------- */

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(({ ns, mark }) => {
  localStorage.clear();
  const P = `glass:${ns}`;
  localStorage.setItem(P + "nv-products", JSON.stringify([
    { id: "p-off", name: mark, category: "serum", time: "AM", status: "active" },
  ]));
  localStorage.setItem(P + "nv-logs", JSON.stringify({}));
}, { ns: `u_${U.id}:`, mark: MARK });

// An hour-old session, exactly the state a PWA opened the next morning is in.
await page.evaluate((s) => {
  localStorage.setItem("glass:sb-auth", JSON.stringify(s));
  localStorage.setItem("glass:auth-mode", "account");
}, session(-3600));

supabaseReachable = false;
await page.addInitScript(() => {
  Object.defineProperty(navigator, "onLine", { get: () => false, configurable: true });
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);

const offlineUi = await bodyText();
check("not dumped on the sign-in wall", !offlineUi.includes("Continue with Google"), offlineUi.slice(0, 140));
check("the routine is reachable", /Good (Morning|Afternoon|Evening)/.test(offlineUi), offlineUi.slice(0, 140));
check("their own shelf is intact", offlineUi.includes(MARK) || (await page.evaluate(
  (ns) => (localStorage.getItem(`glass:${ns}nv-products`) || "").includes("OFFLINE_ONLY_SERUM"), `u_${U.id}:`
)));
check("still reading their own namespace, not guest's", await page.evaluate(
  (ns) => !!localStorage.getItem(`glass:${ns}nv-products`), `u_${U.id}:`
));
check("guest mode was not silently latched", await page.evaluate(
  () => localStorage.getItem("glass:auth-mode") === "account"
));
await page.screenshot({ path: `${OUT}/shots/offline-signed-in.png` });

/* ------------------ 2. edits offline persist to the right store ------------------ */

const before = await page.evaluate((ns) => localStorage.getItem(`glass:${ns}nv-logs`), `u_${U.id}:`);
const row = page.locator('[data-testid="check-row"]').first();
if (await row.count()) {
  await row.click();
  await page.waitForTimeout(1200);
  const after = await page.evaluate((ns) => localStorage.getItem(`glass:${ns}nv-logs`), `u_${U.id}:`);
  check("an offline edit lands in the account's namespace", after !== before, `${before} -> ${after}`);
  check("nothing was written to the guest namespace",
    await page.evaluate(() => !localStorage.getItem("glass:nv-logs")));
} else {
  check("an offline edit lands in the account's namespace", false, "no check row rendered");
}

/* ---------------------- 3. account page tells the truth ---------------------- */

await page.getByLabel("Your account").first().click();
await page.waitForTimeout(900);
const acct = await bodyText();
check("account page does not offer a second sign-in", !/Sign in with Google/i.test(acct), acct.slice(0, 200));
check("account page offers sign out", /Sign out/i.test(acct));
await page.screenshot({ path: `${OUT}/shots/offline-account.png` });

check("no page errors", errors.length === 0, errors.join(" | "));

console.log(`\n===== ${pass} passed, ${fail} failed =====\n`);
await browser.close();
process.exit(fail ? 1 : 0);
