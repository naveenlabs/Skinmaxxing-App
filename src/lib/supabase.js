import { createClient } from "@supabase/supabase-js";

/*
  The client is optional on purpose. With no env vars set — a bare `npm run dev`, a
  fork, or the Playwright audits in scripts/audit/ — this exports null, auth switches
  itself off, and the app behaves exactly as it did before any of this existed.
  Nothing downstream may assume `supabase` is non-null.

  Both values are public by design: the anon key is meant to ship in the bundle, and
  row level security on user_state is what actually protects the data.
*/

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const looksReal = (v) => typeof v === "string" && v.length > 0 && !v.startsWith("your-") && !v.includes("your-project-ref");

export const isSupabaseConfigured = looksReal(url) && looksReal(anonKey);

export const supabase = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: {
        // PKCE keeps the code exchange safe from a browser client, and the redirect
        // (rather than a popup) is the only OAuth shape an installed iOS PWA handles.
        flowType: "pkce",
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "glass:sb-auth",
      },
    })
  : null;

export const PHOTO_BUCKET = "progress-photos";
export const AVATAR_BUCKET = "avatars";

// Dev-only test seam. Account switching is the one path that has to be exercised WITHOUT
// a reload — a reload clears React state and would hide the exact bug the identity-check
// audit exists to catch. Stripped from production builds by the DEV guard.
if (import.meta.env.DEV && typeof window !== "undefined" && supabase) {
  window.__glassSupabase = supabase;
}
