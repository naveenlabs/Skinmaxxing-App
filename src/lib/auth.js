import { useCallback, useEffect, useRef, useState } from "react";
import { supabase, isSupabaseConfigured } from "./supabase.js";
import {
  AUTH_MODE_KEY, LAST_UID_KEY, readDeviceFlag, writeDeviceFlag,
  setNamespace, migrateNamespace, isArtifactRuntime,
} from "./store.js";

/*
  Auth states:
    "loading"    — deciding; the app shows its existing boot screen
    "signed-in"  — a real Supabase session
    "guest"      — deliberately local-only; the app runs exactly as it always has
    "signed-out" — show the sign-in screen

  Guest is not a lesser mode, it's the escape hatch. OAuth inside an installed iOS PWA
  is a long-standing Safari weak spot (popups don't open; redirects can strand you in
  the in-app browser), so there has to be a path that cannot fail. It's also what keeps
  the artifact runtime and the Playwright audits working with no Supabase project at all.
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

/** Whatever came back on the URL after an OAuth round trip, in readable form. */
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
  ["error", "error_description", "error_code", "code", "state"].forEach((k) => {
    if (url.searchParams.has(k)) { url.searchParams.delete(k); touched = true; }
  });
  if (url.hash && /access_token|error|provider_token/.test(url.hash)) { url.hash = ""; touched = true; }
  if (touched) window.history.replaceState({}, "", url.pathname + url.search + url.hash);
}

export function useAuth() {
  const [status, setStatus] = useState("loading");
  const [user, setUser] = useState(null);
  const [error, setError] = useState(null);
  // Set once we've adopted a namespace, so a token refresh doesn't re-run migration.
  const namespacedFor = useRef(undefined);

  const adoptNamespace = useCallback(async (uid) => {
    if (namespacedFor.current === (uid || null)) return;
    if (uid) {
      // LAST_UID_KEY records which account has claimed this device's signed-out data.
      // Unclaimed means the very first sign-in here, so carry that data into the
      // account rather than stranding it. Claimed by someone else means a second
      // person is signing in on a borrowed phone — their account must start clean,
      // and the first person's leftovers stay where they are. It deliberately
      // survives sign-out, which is what stops that leftover data being handed to
      // whoever signs in next.
      const claimedBy = readDeviceFlag(LAST_UID_KEY);
      if (!claimedBy) {
        await migrateNamespace(null, uid);
        writeDeviceFlag(LAST_UID_KEY, uid);
      }
    }
    setNamespace(uid || null);
    namespacedFor.current = uid || null;
  }, []);

  useEffect(() => {
    let alive = true;

    (async () => {
      const urlError = oauthErrorFromUrl();
      if (urlError) { setError(urlError); stripAuthParamsFromUrl(); }

      // No Supabase project, or running inside the artifact host: local-only, no UI.
      if (!isSupabaseConfigured || isArtifactRuntime()) {
        await adoptNamespace(null);
        if (alive) setStatus("guest");
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!alive) return;

      if (data?.session?.user) {
        await adoptNamespace(data.session.user.id);
        if (!alive) return;
        setUser(data.session.user);
        writeDeviceFlag(AUTH_MODE_KEY, "account");
        setStatus("signed-in");
        return;
      }

      if (readDeviceFlag(AUTH_MODE_KEY) === "guest") {
        await adoptNamespace(null);
        if (alive) setStatus("guest");
        return;
      }

      await adoptNamespace(null);
      if (alive) setStatus("signed-out");
    })();

    if (!isSupabaseConfigured) return () => { alive = false; };

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!alive) return;
      if (session?.user) {
        await adoptNamespace(session.user.id);
        if (!alive) return;
        setUser(session.user);
        setError(null);
        writeDeviceFlag(AUTH_MODE_KEY, "account");
        setStatus("signed-in");
      } else if (event === "SIGNED_OUT") {
        namespacedFor.current = undefined;
        await adoptNamespace(null);
        if (!alive) return;
        setUser(null);
        setStatus("signed-out");
      }
    });

    return () => { alive = false; sub?.subscription?.unsubscribe?.(); };
  }, [adoptNamespace]);

  const signInWithGoogle = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setError("Sign-in isn't configured on this build.");
      return;
    }
    setError(null);
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: window.location.origin,
        queryParams: { prompt: "select_account" },
      },
    });
    // On success the browser has already navigated away; only failures land here.
    if (e) setError(e.message || "Couldn't reach Google. Check your connection and try again.");
  }, []);

  const signOut = useCallback(async () => {
    // LAST_UID_KEY is intentionally left alone — see adoptNamespace.
    writeDeviceFlag(AUTH_MODE_KEY, null);
    namespacedFor.current = undefined;
    if (isSupabaseConfigured) { try { await supabase.auth.signOut(); } catch { /* offline: local state still clears */ } }
    setUser(null);
    setNamespace(null);
    setStatus("signed-out");
  }, []);

  const continueAsGuest = useCallback(async () => {
    writeDeviceFlag(AUTH_MODE_KEY, "guest");
    await adoptNamespace(null);
    setStatus("guest");
  }, [adoptNamespace]);

  return {
    status,
    user,
    profile: profileFromUser(user),
    error,
    clearError: useCallback(() => setError(null), []),
    signInWithGoogle,
    signOut,
    continueAsGuest,
    authEnabled: isSupabaseConfigured && !isArtifactRuntime(),
  };
}
