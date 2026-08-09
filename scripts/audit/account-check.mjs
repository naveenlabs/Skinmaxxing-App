// Guest lifecycle, guest→account conversion, profile pictures and email-code sign-in.
//
// The conversion cases are the ones worth being careful about: carrying guest data into
// a brand-new account has to be offered rather than assumed, signing into an account that
// already has a routine must never merge the two, and neither answer may destroy the copy
// sitting on the phone.
//
// Usage: node scripts/audit/account-check.mjs <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] || "/tmp/glass-account";
mkdirSync(`${OUT}/shots`, { recursive: true });

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}

const U = { id: "dddddddd-4444-4444-4444-444444444444", email: "dana@example.com", name: "Dana" };
const GUEST_MARK = "GUEST_ONLY_CLEANSER";
const ACCOUNT_MARK = "ACCOUNT_ONLY_TONER";

const b64url = (o) =>
  Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const userObj = () => ({
  id: U.id, aud: "authenticated", role: "authenticated", email: U.email,
  created_at: "2026-03-01T10:00:00Z",
  user_metadata: { full_name: U.name, given_name: U.name, email: U.email, avatar_url: "" },
});
const session = () => {
  const exp = Math.floor(Date.now() / 1000) + 999999;
  return {
    access_token: [b64url({ alg: "HS256", typ: "JWT" }),
      b64url({ sub: U.id, email: U.email, aud: "authenticated", role: "authenticated", exp }), "sig"].join("."),
    token_type: "bearer", expires_in: 999999, expires_at: exp,
    refresh_token: `r-${U.id}`, user: userObj(),
  };
};
const productsFor = (m) => [{ id: `p-${m}`, name: m, category: "cleanser", time: "Both", status: "active" }];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/supabase|Failed to load resource|Failed to fetch|net::ERR/i.test(m.text())) errors.push(m.text());
});

let rows = new Map();
const writes = [];
let otpSends = 0;
let acceptCode = "654321";

await page.route("**/rest/v1/user_state*", (route) => {
  const req = route.request();
  const uid = (new URL(req.url()).searchParams.get("user_id") || "").replace(/^eq\./, "");
  if (req.method() === "GET") {
    const row = rows.get(uid);
    return route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify(row ? [row] : []) });
  }
  if (req.method() === "POST" || req.method() === "PATCH") {
    let b = {}; try { b = JSON.parse(req.postData() || "{}"); } catch { /* ignore */ }
    const p = Array.isArray(b) ? b[0] : b;
    writes.push(p);
    const stored = { ...(rows.get(p.user_id) || {}), ...p, updated_at: new Date(Date.now() + writes.length * 1000).toISOString() };
    rows.set(p.user_id, stored);
    return route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify([stored]) });
  }
  return route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: "[]" });
});
// A missing object is a 404, not a 200 with a JSON body — matching real Storage.
await page.route("**/storage/v1/**", (route) => {
  const req = route.request();
  if (req.method() === "GET") return route.fulfill({ status: 404, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "not_found" }) });
  return route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: "{}" });
});
await page.route("**/auth/v1/**", (route) => {
  const url = route.request().url();
  const J = (status, body) => route.fulfill({ status, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (/\/auth\/v1\/otp/.test(url)) { otpSends++; return J(200, {}); }
  if (/\/auth\/v1\/verify/.test(url)) {
    let b = {}; try { b = JSON.parse(route.request().postData() || "{}"); } catch { /* ignore */ }
    if (b.token === acceptCode) return J(200, { ...session(), user: userObj() });
    return J(400, { error: "invalid_grant", error_description: "Token has expired or is invalid" });
  }
  if (/\/auth\/v1\/user/.test(url)) return J(200, userObj());
  return J(200, {});
});

const bodyText = () => page.evaluate(() => document.body.innerText);
const seedGuest = (mark) => page.evaluate(({ products, m }) => {
  localStorage.setItem("glass:nv-products", JSON.stringify(products));
  localStorage.setItem("glass:nv-logs", JSON.stringify({ "2026-08-01": { am: { [`p-${m}`]: true }, pm: {} } }));
}, { products: productsFor(mark), m: mark });

const signIn = () => page.evaluate((s) => window.__glassSupabase.auth.setSession(s), session());

/* ===================== 1. guest signing into a NEW account ===================== */

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(async () => {
  localStorage.clear();
  await new Promise((r) => { const q = indexedDB.deleteDatabase("glass"); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  localStorage.setItem("glass:auth-mode", "guest");
});
await seedGuest(GUEST_MARK);
rows = new Map(); // account has nothing yet
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
check("guest sees their own shelf", (await bodyText()).includes(GUEST_MARK));

await signIn();
await page.waitForTimeout(3500);
const offer = await bodyText();
check("new account is OFFERED the guest data", /Bring your routine with you/i.test(offer), offer.slice(0, 160));
check("offer states nothing is deleted", /nothing is deleted/i.test(offer));
await page.screenshot({ path: `${OUT}/shots/account-offer-new.png` });

await page.getByText("Bring it over").click();
await page.waitForTimeout(3000);
const afterBring = await bodyText();
check("data arrives in the account", afterBring.includes(GUEST_MARK), afterBring.slice(0, 140));
check("guest copy is left on the phone", await page.evaluate(
  () => (localStorage.getItem("glass:nv-products") || "").includes("GUEST_ONLY_CLEANSER")));
check("account namespace now has its own copy", await page.evaluate(
  (ns) => (localStorage.getItem(`glass:${ns}nv-products`) || "").includes("GUEST_ONLY_CLEANSER"), `u_${U.id}:`));

/* ================== 2. guest signing into an EXISTING account ================== */

await page.evaluate(async () => {
  localStorage.clear();
  await new Promise((r) => { const q = indexedDB.deleteDatabase("glass"); q.onsuccess = q.onerror = q.onblocked = () => r(); });
  localStorage.setItem("glass:auth-mode", "guest");
});
await seedGuest(GUEST_MARK);
rows = new Map([[U.id, {
  user_id: U.id, display_name: null, products: productsFor(ACCOUNT_MARK),
  logs: { "2026-07-01": { am: {}, pm: {} } }, photo_index: {}, meta: {},
  updated_at: new Date().toISOString(),
}]]);
writes.length = 0;
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await signIn();
await page.waitForTimeout(4000);

const existing = await bodyText();
check("existing account is NOT offered a merge", !/Bring it over/i.test(existing), existing.slice(0, 160));
check("existing account is told plainly", /already has a routine/i.test(existing), existing.slice(0, 200));
check("guest data described as untouched", /untouched/i.test(existing));
await page.screenshot({ path: `${OUT}/shots/account-offer-existing.png` });
await page.getByText("Got it").click();
await page.waitForTimeout(4000);

// Assert against the store rather than the routine list: a product with no stints
// covering today legitimately isn't on today's list, which says nothing about sync.
const acctStore = await page.evaluate((ns) => localStorage.getItem(`glass:${ns}nv-products`) || "", `u_${U.id}:`);
check("account's own data landed on the device", acctStore.includes(ACCOUNT_MARK), acctStore.slice(0, 140));
check("guest data was not merged into the account", !acctStore.includes(GUEST_MARK), acctStore.slice(0, 140));
const merged = await bodyText();
check("the greeting is the account's", /Dana\./.test(merged), merged.slice(0, 120));
check("nothing pushed to the account contains guest data",
  writes.every((w) => !JSON.stringify(w).includes(GUEST_MARK)));
check("guest copy survives on the phone", await page.evaluate(
  () => (localStorage.getItem("glass:nv-products") || "").includes("GUEST_ONLY_CLEANSER")));

/* =========================== 3. profile picture =========================== */

await page.getByLabel("Your account").first().click();
await page.waitForTimeout(1500);
await page.getByLabel(/profile picture/i).first().click();
await page.waitForSelector("text=Choose a picture", { timeout: 5000 }).catch(() => {});
check("avatar sheet offers a picture", /Choose a picture/i.test(await bodyText()));
check("no remove option before one exists", !/Remove picture/i.test(await bodyText()));
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

// Feed a real JPEG through the hidden file input.
const jpegB64 = await page.evaluate(() => {
  const c = document.createElement("canvas"); c.width = c.height = 80;
  const x = c.getContext("2d"); x.fillStyle = "#8fce8f"; x.fillRect(0, 0, 80, 80);
  return c.toDataURL("image/jpeg", 0.8).split(",")[1];
});
await page.setInputFiles('input[type="file"][accept="image/*"]:not([multiple])', {
  name: "me.jpg", mimeType: "image/jpeg", buffer: Buffer.from(jpegB64, "base64"),
});
await page.waitForTimeout(2500);
check("avatar is stored locally", await page.evaluate(async (ns) => {
  const db = await new Promise((r) => { const q = indexedDB.open("glass", 1); q.onsuccess = () => r(q.result); });
  const keys = await new Promise((r) => {
    const q = db.transaction("photos", "readonly").objectStore("photos").getAllKeys();
    q.onsuccess = () => r(q.result || []);
  });
  return keys.includes(`${ns}avatar`);
}, `u_${U.id}:`));
await page.screenshot({ path: `${OUT}/shots/account-avatar.png` });

await page.getByLabel(/profile picture/i).first().click();
await page.waitForTimeout(700);
check("remove option appears once a picture exists", /Remove picture/i.test(await bodyText()));
await page.getByText("Remove picture").click();
await page.waitForTimeout(1800);
check("avatar is gone locally", await page.evaluate(async (ns) => {
  const db = await new Promise((r) => { const q = indexedDB.open("glass", 1); q.onsuccess = () => r(q.result); });
  const keys = await new Promise((r) => {
    const q = db.transaction("photos", "readonly").objectStore("photos").getAllKeys();
    q.onsuccess = () => r(q.result || []);
  });
  return !keys.includes(`${ns}avatar`);
}, `u_${U.id}:`));

/* ===================== 4. rejecting a non-image upload ===================== */

await page.getByLabel(/profile picture/i).first().click();
await page.waitForTimeout(600);
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
await page.setInputFiles('input[type="file"][accept="image/*"]:not([multiple])', {
  name: "payload.txt", mimeType: "text/plain", buffer: Buffer.from("not an image at all"),
});
await page.waitForTimeout(1500);
check("a non-image upload is refused", /doesn't look like an image/i.test(await bodyText()), (await bodyText()).slice(0, 140));

/* ======================= 5. guest mode has a way out ======================= */

await page.evaluate(() => { localStorage.clear(); localStorage.setItem("glass:auth-mode", "guest"); });
await seedGuest(GUEST_MARK);
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.getByLabel("Your account").first().click();
await page.waitForTimeout(900);
check("guest is offered an exit", /Exit guest mode/i.test(await bodyText()));
await page.getByText("Exit guest mode").click();
await page.waitForTimeout(800);
const warn = await bodyText();
check("exiting warns the data is only on this phone", /only on this phone/i.test(warn), warn.slice(0, 200));
check("exiting nudges toward signing in", /signing in with Google/i.test(warn));
await page.screenshot({ path: `${OUT}/shots/account-exit-guest.png` });
await page.getByRole("button", { name: "Leave guest mode" }).click();
await page.waitForTimeout(1800);
check("exiting lands on the sign-in screen", (await bodyText()).includes("Continue with Google"));
check("guest data was not deleted", await page.evaluate(() => !!localStorage.getItem("glass:nv-products")));

/* ========================== 6. email code sign-in ========================== */

await page.getByText("Email me a code instead").click();
await page.waitForTimeout(700);
check("code sheet opens", /Sign in with a code/i.test(await bodyText()));
await page.getByLabel("Email address").fill("dana@example.com");
await page.getByText("Email me a code", { exact: true }).click();
await page.waitForTimeout(1500);
check("a code was requested", otpSends === 1, String(otpSends));
check("moves to the code step", /Check your email/i.test(await bodyText()));
await page.screenshot({ path: `${OUT}/shots/account-code.png` });

await page.getByLabel("Six-digit code").fill("111111");
await page.getByText("Verify and sign in").click();
await page.waitForTimeout(1500);
check("a wrong code is rejected", /isn't right|expired/i.test(await bodyText()), (await bodyText()).slice(0, 160));
check("rejection does not reveal whether the account exists",
  !/no account|not found|unknown|already registered/i.test(await bodyText()));

const resendLabel = await page.evaluate(() =>
  [...document.querySelectorAll("button")].map((b) => b.textContent).find((t) => /Send another code/.test(t || "")));
check("resend is on a cooldown", /in \d+s/.test(resendLabel || ""), String(resendLabel));

await page.getByLabel("Six-digit code").fill(acceptCode);
await page.getByText("Verify and sign in").click();
await page.waitForTimeout(3000);
check("the right code signs in", /Good (Morning|Afternoon|Evening)/.test(await bodyText()), (await bodyText()).slice(0, 140));

check("no page errors", errors.length === 0, errors.join(" | "));

console.log(`\n===== ${pass} passed, ${fail} failed =====\n`);
await browser.close();
process.exit(fail ? 1 : 0);
