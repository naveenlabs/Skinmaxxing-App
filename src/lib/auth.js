import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabase.js";
import {
  AUTH_MODE_KEY, LAST_UID_KEY, SB_AUTH_KEY,
  readDeviceFlag, writeDeviceFlag, setNamespace, isArtifactRuntime,
} from "./store.js";

/*
  Auth states:
    "loading"            — deciding; the app shows its existing boot screen
    "signed-in"          — a verified Supabase session
    "offline-unverified" — a persisted session we could not reach the server to confirm
    "guest"              — deliberately local-only
    "signed-out"         — show the sign-in screen

  `offline-unverified` exists because the previous version locked people out of their own
  data: access tokens expire hourly, so opening the app offline an hour after last use made
  getSession() return null, which fell through to "signed-out" — a sign-in wall with the
  user's entire routine sitting unreachable in `glass:u_<uid>:*`. Now a session we can't
  *verify* still opens the app against that namespace, read-write, local-only. It grants no
  new authority: every cloud call still carries a real token and RLS still rejects anything
  else. Only a definitive server rejection signs someone out.

  Guest is not a lesser mode, it's the escape hatch. OAuth inside an installed iOS PWA is a
  long-standing Safari weak spot, so there has to be a path that cannot fail. It's also what
  keeps the artifact runtime and the Playwright audits working with no Supabase project.
*/

export function profileFromUser(user) {
  if (!user) return null;
  const m = user.user_metadata || {};
  const fullName = m.full_name || m.name || "";
  const given = m.given_name || (fullName ? fullName.split(" ")[0] : "");
  return {
    id: user.id,
    email: user.email || "",
    fullName,
    givenName: given,
    avatarUrl: m.avatar_url || m.picture || "",
    createdAt: user.created_at || null,
  };
}

const isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/** A failure we should retry rather than treat as "your session is invalid". */
function isRetryableAuthError(error) {
  if (!error) return false;
  if (!isOnline()) return true;
  const name = error.name || "";
  const msg = (error.message || "").toLowerCase();
  return name === "AuthRetryableFetchError"
    || msg.includes("failed to fetch")
    || msg.includes("network")
    || msg.includes("timeout")
    || (typeof error.status === "number" && error.status >= 500);
}

/** The session supabase-js persisted, read directly — used only when the server is unreachable. */
function cachedUserFromStorage() {
  try {
    const raw = window.localStorage.getItem(SB_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const user = parsed?.user || parsed?.currentSession?.user || null;
    return user?.id ? user : null;
  } catch { return null; }
}

function oauthErrorFromUrl() {
  if (typeof window === "undefined") return null;
  const read = (s) => new URLSearchParams(s);
  const q = read(window.location.search);
  const h = read(window.location.hash.replace(/^#/, ""));
  const code = q.get("error") || h.get("error");
  if (!code) return null;
  const desc = q.get("error_description") || h.get("error_description") || "";
  if (code === "access_denied") return "Sign-in was cancelled.";
  return desc ? desc.replace(/\+/g, " ") : "Sign-in didn't complete. Try again.";
}

function stripAuthParamsFromUrl() {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  const url = new URL(window.location.href);
  let touched = false;
  ["error", "error_description", "error_code"].forEach((k) => {
    if (url.searchParams.has(k)) { url.searchParams.delete(k); touched = true; }
  });
  if (url.hash && /error/.test(url.hash)) { url.hash = ""; touched = true; }
  if (touched) window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

export function useAuth() {
  const [status, setStatus] = useState("loading");
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  const namespacedFor = useRef(undefined);

  // Namespace only. Guest data is NOT moved here — that conversion is an explicit,
  // user-answered step, and doing it implicitly meant the choice sheet's promise that
  // "nothing is deleted until you pick" was already false by the time it appeared.
  const adoptNamespace = useCallback((uid) => {
    const next = uid || null;
    if (namespacedFor.current === next) return;
    setNamespace(next);
    namespacedFor.current = next;
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      const urlError = oauthErrorFromUrl();
      if (urlError) { setError(urlError); stripAuthParamsFromUrl(); }

      if (!isSupabaseConfigured || isArtifactRuntime()) {
        adoptNamespace(null);
        if (alive) setStatus("guest");
        return;
      }

      const cachedAtBoot = cachedUserFromStorage();
      const wasSignedIn = readDeviceFlag(AUTH_MODE_KEY) === "account";

      // Already known to be offline with a session in hand: don't call out at all. The
      // retry effect below verifies as soon as the network returns.
      if (!isOnline() && wasSignedIn && cachedAtBoot) {
        adoptNamespace(cachedAtBoot.id);
        setUser(cachedAtBoot);
        setStatus("offline-unverified");
        return;
      }

      let data = null;
      let sessionError = null;
      try {
        // supabase-js retries a failed token refresh with backoff, which can leave the
        // app on its boot screen for many seconds on a dead connection. Cap the wait: a
        // cached session is enough to open the app, and verification continues in the
        // background.
        const res = await Promise.race([
          supabase.auth.getSession(),
          new Promise((resolve) => setTimeout(() => resolve({ data: null, error: { name: "AuthRetryableFetchError", message: "timed out" } }), 3000)),
        ]);
        data = res.data;
        sessionError = res.error;
      } catch (e) { sessionError = e; }
      if (!alive) return;

      if (data?.session?.user) {
        adoptNamespace(data.session.user.id);
        setUser(data.session.user);
        writeDeviceFlag(AUTH_MODE_KEY, "account");
        setStatus("signed-in");
        return;
      }

      // Couldn't confirm a session. If this device was signed in and the failure looks
      // like the network rather than a rejection, keep the user in their own data.
      if (wasSignedIn) {
        const cached = cachedAtBoot || cachedUserFromStorage();
        if (cached && (isRetryableAuthError(sessionError) || !isOnline())) {
          adoptNamespace(cached.id);
          setUser(cached);
          setStatus("offline-unverified");
          return;
        }
      }

      if (readDeviceFlag(AUTH_MODE_KEY) === "guest") {
        adoptNamespace(null);
        if (alive) setStatus("guest");
        return;
      }

      adoptNamespace(null);
      if (alive) setStatus("signed-out");
    })();

    if (!isSupabaseConfigured) return () => { alive = false; };

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!alive) return;
      if (session?.user) {
        adoptNamespace(session.user.id);
        setUser(session.user);
        writeDeviceFlag(AUTH_MODE_KEY, "account");
        // Only a fresh sign-in clears a visible error; a background token refresh must
        // not wipe a message the user is still reading.
        if (event === "SIGNED_IN" || event === "USER_UPDATED") setError(null);
        setStatus("signed-in");
        return;
      }
      if (event === "SIGNED_OUT") {
        // supabase emits SIGNED_OUT when a refresh fails, including offline. Don't eject
        // someone from their own device over a dropped connection.
        const cached = cachedUserFromStorage();
        if (!isOnline() && cached && readDeviceFlag(AUTH_MODE_KEY) === "account") {
          adoptNamespace(cached.id);
          setUser(cached);
          setStatus("offline-unverified");
          return;
        }
        writeDeviceFlag(AUTH_MODE_KEY, null);
        namespacedFor.current = undefined;
        adoptNamespace(null);
        setUser(null);
        setStatus("signed-out");
      }
    });

    return () => { alive = false; sub?.subscription?.unsubscribe?.(); };
  }, [adoptNamespace]);

  /** Retry verification when the network comes back during offline-unverified. */
  useEffect(() => {
    if (status !== "offline-unverified" || !isSupabaseConfigured) return undefined;
    let alive = true;
    const retry = async () => {
      try {
        const { data, error: e } = await supabase.auth.getSession();
        if (!alive) return;
        if (data?.session?.user) {
          adoptNamespace(data.session.user.id);
          setUser(data.session.user);
          setStatus("signed-in");
        } else if (e && !isRetryableAuthError(e)) {
          writeDeviceFlag(AUTH_MODE_KEY, null);
          namespacedFor.current = undefined;
          adoptNamespace(null);
          setUser(null);
          setError("Your session expired. Please sign in again.");
          setStatus("signed-out");
        }
      } catch { /* still unreachable — stay put */ }
    };
    window.addEventListener("online", retry);
    const t = setInterval(retry, 60_000);
    return () => { alive = false; window.removeEventListener("online", retry); clearInterval(t); };
  }, [status, adoptNamespace]);

  const signInWithGoogle = useCallback(async () => {
    if (!isSupabaseConfigured) { setError("Sign-in isn't configured on this build."); return; }
    setError(null);
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin, queryParams: { prompt: "select_account" } },
    });
    if (e) setError(e.message || "Couldn't reach Google. Check your connection and try again.");
  }, []);

  /*
    Email code sign-in. Supabase's own OTP is used rather than anything hand-rolled: the
    code is generated, stored and verified server-side, so `verifyOtp` succeeding is real
    proof of email ownership. A client-side OTP would be theatre.

    Account enumeration: `shouldCreateUser: true` means requesting a code behaves
    identically whether or not the address already has an account — nothing in the
    response or the UI distinguishes the two. Whether the account already holds a routine
    is only ever revealed *after* verification, at which point ownership is proven.

    Expiry, send-rate and maximum verification attempts are enforced by Supabase (see the
    Auth settings noted in docs/SETUP.md). The cooldown below is UX, not the control.
  */
  const sendCode = useCallback(async (email) => {
    if (!isSupabaseConfigured) return { ok: false, error: "Sign-in isn't configured on this build." };
    const address = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
      return { ok: false, error: "That doesn't look like an email address." };
    }
    try {
      const { error: e } = await supabase.auth.signInWithOtp({
        email: address,
        options: { shouldCreateUser: true },
      });
      if (e) {
        const msg = e.message || "";
        if (/rate|too many|limit/i.test(msg)) {
          return { ok: false, error: "Too many codes requested. Wait a minute and try again." };
        }
        if (/fetch|network/i.test(msg) || !isOnline()) {
          return { ok: false, error: "Couldn't reach the server. Check your connection." };
        }
        // Anything else is reported generically so nothing distinguishes a known
        // address from an unknown one.
        console.warn("[glass] sendCode:", msg);
        return { ok: false, error: "Couldn't send a code just now. Try again in a moment." };
      }
      return { ok: true, email: address };
    } catch {
      return { ok: false, error: "Couldn't reach the server. Check your connection." };
    }
  }, []);

  const verifyCode = useCallback(async (email, code) => {
    if (!isSupabaseConfigured) return { ok: false, error: "Sign-in isn't configured on this build." };
    const token = String(code || "").replace(/\D/g, "");
    if (token.length < 6) return { ok: false, error: "Enter the 6-digit code from your email." };
    try {
      const { data, error: e } = await supabase.auth.verifyOtp({
        email: String(email).trim().toLowerCase(), token, type: "email",
      });
      if (e) {
        const msg = e.message || "";
        if (/expire/i.test(msg)) return { ok: false, error: "That code has expired — send a new one." };
        if (/rate|too many|limit/i.test(msg)) {
          return { ok: false, error: "Too many attempts. Request a new code." };
        }
        return { ok: false, error: "That code isn't right. Check it and try again." };
      }
      if (!data?.session) return { ok: false, error: "That code isn't right. Check it and try again." };
      return { ok: true };
    } catch {
      return { ok: false, error: "Couldn't reach the server. Check your connection." };
    }
  }, []);

  const signOut = useCallback(async () => {
    writeDeviceFlag(AUTH_MODE_KEY, null);
    namespacedFor.current = undefined;
    setError(null);
    if (isSupabaseConfigured) {
      try { await supabase.auth.signOut(); } catch { /* offline: local state still clears */ }
    }
    setUser(null);
    setNamespace(null);
    namespacedFor.current = null;
    setStatus("signed-out");
  }, []);

  const continueAsGuest = useCallback(() => {
    writeDeviceFlag(AUTH_MODE_KEY, "guest");
    adoptNamespace(null);
    setStatus("guest");
  }, [adoptNamespace]);

  /** Leave guest mode without destroying anything. */
  const exitGuest = useCallback(() => {
    writeDeviceFlag(AUTH_MODE_KEY, null);
    adoptNamespace(null);
    setStatus("signed-out");
  }, [adoptNamespace]);

  const signedIn = status === "signed-in" || status === "offline-unverified";

  return {
    status,
    signedIn,
    isGuest: status === "guest",
    offline: status === "offline-unverified",
    user,
    profile: profileFromUser(user),
    error,
    setError,
    clearError: useCallback(() => setError(null), []),
    signInWithGoogle,
    sendCode,
    verifyCode,
    signOut,
    continueAsGuest,
    exitGuest,
    authEnabled: isSupabaseConfigured && !isArtifactRuntime(),
    lastUidKey: LAST_UID_KEY,
  };
}
