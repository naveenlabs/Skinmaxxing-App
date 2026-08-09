// The leak regression. This is the test that must never go red.
//
// Account A's data must never reach account B — not on screen, not in local storage, and
// above all not in the row pushed to B's account. The original bug needed no race and no
// second tab: React state outlived the session change and `ready` was never reset, so the
// sync engine started pushing A's documents the moment B signed in.
//
// Every Supabase REST call is intercepted, so we can assert on exactly what would have
// been written to the server. Session switching goes through window.__glassSupabase (a
// DEV-only seam) rather than a reload, because a reload clears React state and would hide
// the very thing this file exists to catch.
//
// Usage: node scripts/audit/identity-check.mjs <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.argv[2] || "/tmp/glass-identity";
mkdirSync(`${OUT}/shots`, { recursive: true });

let pass = 0, fail = 0;
function check(name, ok, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}  ${detail}`); }
}

const A = { id: "aaaaaaaa-1111-1111-1111-111111111111", email: "alex@example.com", name: "Alex" };
const B = { id: "bbbbbbbb-2222-2222-2222-222222222222", email: "blair@example.com", name: "Blair" };

const MARK_A = "ALPHA_ONLY_CLEANSER";
const MARK_B = "BRAVO_ONLY_TONER";

const b64url = (o) =>
  Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const userObj = (u) => ({
  id: u.id, aud: "authenticated", role: "authenticated", email: u.email,
  email_confirmed_at: "2026-02-14T10:00:00Z",
  created_at: "2026-02-14T10:00:00Z", updated_at: "2026-02-14T10:00:00Z",
  app_metadata: { provider: "google", providers: ["google"] },
  user_metadata: { full_name: u.name, given_name: u.name, email: u.email, avatar_url: "" },
});

// supabase-js decodes the access token client-side, so it has to be a structurally valid
// JWT — signature is never checked in the browser, but the shape is.
const session = (u) => {
  const exp = Math.floor(Date.now() / 1000) + 999999;
  const token = [
    b64url({ alg: "HS256", typ: "JWT" }),
    b64url({ sub: u.id, email: u.email, aud: "authenticated", role: "authenticated", exp, iat: Math.floor(Date.now() / 1000) }),
    // Never verified in the browser, but it still has to decode: a length of n % 4 === 1
    // is not valid base64 and supabase-js rejects the whole token.
    "sig",
  ].join(".");
  return {
    access_token: token,
    token_type: "bearer",
    expires_in: 999999,
    expires_at: exp,
    refresh_token: `fake-refresh-${u.id}`,
    user: userObj(u),
  };
};

const productsFor = (mark) => [
  { id: `p-${mark}`, name: mark, category: "cleanser", time: "Both", tracked: false, exfoliant: false, status: "active" },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 852 } });

const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error" && !/supabase|Failed to fetch|net::ERR/i.test(m.text())) errors.push(m.text());
});

// ---- fake Supabase REST layer -------------------------------------------------
// rows: what the server "holds"; writes: everything the client tried to send.
const rows = new Map();
const writes = [];

await page.route("**/rest/v1/user_state*", async (route) => {
  const req = route.request();
  const method = req.method();
  const url = new URL(req.url());
  const uid = (url.searchParams.get("user_id") || "").replace(/^eq\./, "");

  if (method === "GET") {
    const row = rows.get(uid);
    return route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(row ? [row] : []),
    });
  }
  if (method === "POST" || method === "PATCH") {
    let body = {};
    try { body = JSON.parse(req.postData() || "{}"); } catch { /* ignore */ }
    const payload = Array.isArray(body) ? body[0] : body;
    writes.push(payload);
    const stored = {
      ...(rows.get(payload.user_id) || {}),
      ...payload,
      updated_at: new Date(Date.now() + writes.length * 1000).toISOString(),
    };
    rows.set(payload.user_id, stored);
    return route.fulfill({
      status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify([stored]),
    });
  }
  if (method === "DELETE") {
    rows.delete(uid);
    return route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: "[]" });
  }
  return route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: "[]" });
});
// Storage: succeed silently, not what this file is testing.
await page.route("**/storage/v1/**", (r) =>
  r.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: "[]" }));

// Auth: /user must answer with whoever the bearer token belongs to, or setSession's
// verification fails and the sign-in never completes.
// Whoever the harness is currently pretending to be. Set explicitly rather than sniffed
// out of the Authorization header — supabase-js doesn't always send one, and a silent 401
// here looks exactly like a failed sign-in.
let currentUser = null;

await page.route("**/auth/v1/**", (route) => {
  if (/\/auth\/v1\/user/.test(route.request().url())) {
    return route.fulfill({
      status: currentUser ? 200 : 401,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(currentUser ? userObj(currentUser) : { message: "invalid token" }),
    });
  }
  return route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: "{}" });
});

const seedNamespace = async (uid, mark) => {
  await page.evaluate(({ ns, products, mark: m }) => {
    const P = `glass:${ns}`;
    localStorage.setItem(P + "nv-products", JSON.stringify(products));
    localStorage.setItem(P + "nv-logs", JSON.stringify({ "2026-08-01": { am: { [`p-${m}`]: true }, pm: {} } }));
    localStorage.setItem(P + "nv-profile", JSON.stringify({ displayName: m }));
  }, { ns: uid ? `u_${uid}:` : "", products: productsFor(mark), mark });
};

const setSession = async (u) => {
  currentUser = u;
  const r = await page.evaluate(
    (s) => window.__glassSupabase.auth.setSession(s).then((x) => (x.error ? String(x.error.message) : null)),
    session(u)
  );
  if (r) throw new Error(`setSession(${u.name}) failed: ${r}`);
};

const bodyText = () => page.evaluate(() => document.body.innerText);

// A device holding local data that signs into an account which also has data gets the
// "two sets of data" sheet. Legitimate, but it sits over the header, so clear it before
// driving the UI.
const dismissChoice = async () => {
  const btn = page.getByText("Use my account's", { exact: true });
  if (await btn.count()) { await btn.first().click(); await page.waitForTimeout(1200); }
};

const openAccount = async () => {
  await dismissChoice();
  await page.getByLabel("Your account").first().click();
  await page.waitForTimeout(800);
};
// Mirrors store.js listKeys: for the guest namespace, "glass:" also prefix-matches every
// signed-in key, so those have to be excluded or the dump reads as a false leak.
const nsDump = (uid) => page.evaluate((ns) => {
  const P = `glass:${ns}`;
  return Object.keys(localStorage)
    .filter((k) => k.startsWith(P))
    .filter((k) => ns !== "" || !/^glass:u_[^:]+:/.test(k))
    .map((k) => localStorage.getItem(k)).join("|");
}, uid ? `u_${uid}:` : "");

/* ============================ 1. A → sign out → B ============================ */

await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded" });
await page.evaluate(() => localStorage.clear());
await seedNamespace(A.id, MARK_A);
await seedNamespace(B.id, MARK_B);
rows.set(B.id, {
  user_id: B.id, display_name: MARK_B,
  products: productsFor(MARK_B), logs: {}, photo_index: {}, meta: {},
  updated_at: new Date().toISOString(),
});

currentUser = A;
await page.evaluate((s) => {
  localStorage.setItem("glass:sb-auth", JSON.stringify(s));
  localStorage.setItem("glass:auth-mode", "account");
}, session(A));
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(2500);

check("A signs in and sees A's shelf", (await bodyText()).includes(MARK_A));
await page.screenshot({ path: `${OUT}/shots/identity-a.png` });

// Sign out through the UI — deliberately no reload, so React still holds A's state.
await openAccount();
await page.getByText("Sign out", { exact: true }).click();
await page.waitForTimeout(1500);
check("sign out lands on the sign-in screen", (await bodyText()).includes("Continue with Google"));

writes.length = 0;
await setSession(B);

// Sample hard through the switch. The push leak is blocked by the epoch gate alone, but
// A's documents must not be on screen for even a frame while B's boot read is in flight —
// that transient is the other half of the same bug and only the state reset closes it.
let flashedA = false;
for (let i = 0; i < 24; i++) {
  const t = await bodyText();
  if (t.includes(MARK_A)) { flashedA = true; break; }
  await page.waitForTimeout(50);
}
check("A's data never flashes on screen during the switch", !flashedA);

await page.waitForTimeout(3000);

const uiAfterB = await bodyText();
check("B does not see A's products on screen", !uiAfterB.includes(MARK_A), uiAfterB.slice(0, 160));
check("B sees B's own products", uiAfterB.includes(MARK_B) || uiAfterB.includes("Good "), uiAfterB.slice(0, 120));

const pushedToB = writes.filter((w) => w.user_id === B.id);
const leaked = pushedToB.filter((w) => JSON.stringify(w).includes(MARK_A));
check("nothing pushed to B's row contains A's data", leaked.length === 0,
  leaked.length ? JSON.stringify(leaked[0]).slice(0, 220) : "");
check("nothing was pushed to A's row after signing out",
  writes.filter((w) => w.user_id === A.id).length === 0);
check("A's namespace still holds A's data", (await nsDump(A.id)).includes(MARK_A));
check("B's namespace never gained A's data", !(await nsDump(B.id)).includes(MARK_A));
await page.screenshot({ path: `${OUT}/shots/identity-b.png` });

/* ============================ 2. B → guest → A ============================== */

writes.length = 0;
await openAccount();
await page.getByText("Sign out", { exact: true }).click();
await page.waitForTimeout(1200);
await page.getByText("Continue without an account").click();
await page.waitForTimeout(1800);

const guestUi = await bodyText();
check("guest sees neither account's products",
  !guestUi.includes(MARK_A) && !guestUi.includes(MARK_B), guestUi.slice(0, 160));
check("guest namespace is clean", !(await nsDump(null)).includes(MARK_A));

await setSession(A);
await page.waitForTimeout(3500);
const backToA = await bodyText();
check("A signs back in and sees A's own data", backToA.includes(MARK_A));
check("A never sees B's data", !backToA.includes(MARK_B), backToA.slice(0, 160));
const pushedToA = writes.filter((w) => w.user_id === A.id);
check("nothing pushed to A's row contains B's data",
  pushedToA.every((w) => !JSON.stringify(w).includes(MARK_B)));

/* ==================== 3. display name must not carry over =================== */

check("greeting does not carry the other identity's name",
  !backToA.includes(`${MARK_B}.`), backToA.slice(0, 120));

/* ============ 4. direct A → B swap, no sign-out screen in between ============ */
// This is the two-tab / session-replacement path: the app is fully rendered as A and the
// session changes underneath it. Nothing masks the swap, so if state isn't reset by
// identity, A's shelf is visibly on screen while B's boot read is still in flight.

writes.length = 0;
await dismissChoice();
let flashedDirect = false;
const sawA = (await bodyText()).includes(MARK_A);
await setSession(B);
for (let i = 0; i < 30; i++) {
  const t = await bodyText();
  if (t.includes(MARK_A)) { flashedDirect = true; break; }
  await page.waitForTimeout(40);
}
check("app was showing A before the swap (sanity)", sawA);
check("direct A→B swap never renders A's data", !flashedDirect);

await page.waitForTimeout(3000);
const directWrites = writes.filter((w) => w.user_id === B.id);
check("direct swap pushes nothing of A's to B",
  directWrites.every((w) => !JSON.stringify(w).includes(MARK_A)),
  directWrites.length ? JSON.stringify(directWrites[0]).slice(0, 200) : "");

check("no page errors throughout", errors.length === 0, errors.join(" | "));

console.log(`\n===== ${pass} passed, ${fail} failed =====\n`);
await browser.close();
process.exit(fail ? 1 : 0);
