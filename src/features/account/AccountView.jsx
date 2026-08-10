// Sign-in, the account screen, and every sheet that hangs off it.
import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  Camera,
  ChevronRight,
  Cloud,
  CloudUpload,
  Download,
  Droplet,
  Loader2,
  LogOut,
  Pencil,
  RefreshCw,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { HERO_IMG } from "../../assets.js";
import { StorageMeter } from "../../components/StorageMeter.jsx";
import {
  ConfirmModal,
  GhostButton,
  PrimaryButton,
  Section,
  Sheet,
  SheetHeader,
  Stagger,
  StaggerItem,
  Stat,
} from "../../components/primitives.jsx";
import { plural, timeAgo } from "../../domain/dates.js";
import { currentStreakDays, dayCompletionPct } from "../../domain/routine.js";
import { ExportSheet } from "../insights/InsightsView.jsx";
import { iconBtnStyle } from "../today/TodayView.jsx";
import { SPRING, TONES } from "../../styles/theme.js";

// Google's mark, inline. The whole app is self-hosted and works offline; reaching out
// to a CDN for one 18px logo would be the only thing on the page that doesn't.
export function GoogleMark({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M45.1 24.5c0-1.6-.1-2.8-.4-4H24v7.3h12.1c-.2 2-1.6 5-4.5 7l-.1.3 6.5 5 .5.1c4.1-3.8 6.6-9.4 6.6-15.7z" />
      <path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.800000000000001l-.3.1-6.7 5.2-.1.3C7.9 40.9 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.5 27.7c-.5-1.4-.7-2.9-.7-4.5s.3-3.1.7-4.5v-.3l-6.8-5.3-.2.1C2.9 16.3 2 20 2 23.9s.9 7.6 2.5 10.8l7-7z" />
      <path fill="#EA4335" d="M24 9.8c4.1 0 6.9 1.8 8.5 3.3l6.2-6C34.9 3.7 29.9 1.6 24 1.6 15.4 1.6 7.9 6.7 4.5 13.1l7 5.4C13.3 12.6 18.2 9.8 24 9.8z" />
    </svg>
  );
}

// Replaces the inert monogram that used to sit in the Routine header. Now a real
// control that opens the account page. Sized to Apple's 44pt minimum tap target --
// the previous 34px chip was comfortably missable, especially in the top-right
// corner where it also competes with the Control Center swipe-down gesture.
export function AccountButton({ monogram, avatarUrl, onClick }) {
  const [broken, setBroken] = useState(false);
  const showImage = avatarUrl && !broken;
  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.94 }}
      transition={SPRING}
      aria-label="Your account"
      className="u-tap"
      style={{
        width: 44, height: 44, borderRadius: 999, border: "1px solid var(--line-3)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
        overflow: "hidden", background: "rgba(10,7,5,0.42)", backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)", flexShrink: 0,
      }}
    >
      {showImage ? (
        <img
          src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <span className="u-display" style={{ fontSize: 18, color: "var(--gold)" }}>{monogram || "S"}</span>
      )}
    </motion.button>
  );
}

export function SignInScreen({ onGoogle, onGuest, error, onDismissError }) {
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    await onGoogle();
    // A successful sign-in navigates away, so reaching here means it didn't start.
    setBusy(false);
  }

  return (
    <div style={{ position: "relative", minHeight: "100vh", display: "flex", flexDirection: "column", overflow: "hidden", isolation: "isolate" }}>
      <img
        src={HERO_IMG} alt="" aria-hidden="true" className="u-hero-img"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", objectPosition: "62% 42%" }}
      />
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0,
        background:
          "radial-gradient(120% 80% at 8% 12%, rgba(10,7,5,0.94) 0%, rgba(10,7,5,0.62) 38%, rgba(10,7,5,0.08) 72%)," +
          "linear-gradient(180deg, rgba(10,7,5,0.55) 0%, rgba(10,7,5,0.10) 22%, rgba(10,7,5,0.72) 58%, var(--ink-0) 88%)",
      }} />
      <div aria-hidden="true" style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(70% 50% at 88% 6%, rgba(243,201,140,0.16), transparent 70%)",
        mixBlendMode: "screen",
      }} />

      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: "0 24px calc(38px + env(safe-area-inset-bottom))" }}>
        <motion.div
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 14 }}>
            <Droplet size={14} color="var(--gold)" strokeWidth={2} />
            <span className="u-eyebrow" style={{ color: "var(--gold)" }}>Skincare, kept honest</span>
          </div>
          <h1 className="u-display" style={{ fontSize: 46, color: "var(--text)", margin: 0, lineHeight: 1.02 }}>
            Welcome to<br />
            <span style={{ fontStyle: "italic", color: "var(--gold)" }}>Skinmaxxing.</span>
          </h1>
          <p style={{ fontSize: 13.5, color: "var(--text-2)", margin: "16px 0 0", maxWidth: 280, lineHeight: 1.6 }}>
            Your AM and PM routine, every product on your shelf, and the progress to prove
            it's working — on every device you sign in from.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.16, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginTop: 30 }}
        >
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.24 }}
                role="alert"
                style={{ overflow: "hidden" }}
              >
                <div style={{
                  display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 12,
                  padding: "11px 13px", borderRadius: 14,
                  background: "var(--rose-wash)", border: "1px solid rgba(226,160,141,0.3)",
                }}>
                  <AlertTriangle size={14} color="var(--rose)" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, flex: 1 }}>{error}</span>
                  <button onClick={onDismissError} aria-label="Dismiss" className="u-tap" style={{ background: "none", border: "none", padding: 0, flexShrink: 0 }}>
                    <X size={13} color="var(--text-3)" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <motion.button
            onClick={go}
            disabled={busy}
            whileTap={busy ? undefined : { scale: 0.98 }}
            transition={SPRING}
            className="u-tap"
            style={{
              width: "100%", padding: "14px 0", borderRadius: 14, border: "none",
              background: "linear-gradient(180deg, var(--gold), var(--gold-2))",
              color: "#20150C", fontSize: 14, fontWeight: 700, letterSpacing: "0.01em",
              boxShadow: "0 10px 24px -12px rgba(243,201,140,0.6)",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <GoogleMark size={17} />}
            {busy ? "Opening Google…" : "Continue with Google"}
          </motion.button>

          <button
            onClick={onGuest}
            className="u-tap"
            style={{
              display: "block", width: "100%", marginTop: 16, padding: "8px 0",
              background: "none", border: "none",
              fontSize: 12.5, color: "var(--text-3)", fontWeight: 500,
            }}
          >
            Continue without an account
          </button>
          <p style={{ fontSize: 11, color: "var(--text-3)", textAlign: "center", margin: "4px 0 0", lineHeight: 1.55, opacity: 0.75 }}>
            Everything stays on this phone until you sign in.
          </p>
        </motion.div>
      </div>
    </div>
  );
}

// Settings row, built on the same recipe as the ExportSheet action card so the account
// page reads as part of the app rather than a bolted-on preferences pane.

// Settings row, built on the same recipe as the ExportSheet action card so the account
// page reads as part of the app rather than a bolted-on preferences pane.
export function SettingRow({ icon: Icon, title, body, value, onClick, tone = "gold", disabled, danger }) {
  const Comp = onClick && !disabled ? motion.button : "div";
  const interactive = !!onClick && !disabled;
  return (
    <Comp
      {...(interactive ? { onClick, whileTap: { scale: 0.985 }, transition: SPRING, className: "u-tap" } : {})}
      style={{
        width: "100%", textAlign: "left", borderRadius: 18, padding: 16, marginBottom: 10,
        display: "flex", alignItems: "center", gap: 13,
        border: `1px solid ${danger ? "rgba(226,160,141,0.28)" : "var(--line)"}`,
        background: "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018))",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <div style={{
        width: 36, height: 36, borderRadius: 999, flexShrink: 0,
        background: danger ? "var(--rose-wash)" : TONES[tone].wash2,
        border: `1px solid ${danger ? "rgba(226,160,141,0.3)" : "var(--line-2)"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <Icon size={16} color={danger ? "var(--rose)" : TONES[tone].fg} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, color: danger ? "var(--rose)" : "var(--text)", fontWeight: 600 }}>{title}</div>
        {body && <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 4, lineHeight: 1.55 }}>{body}</div>}
      </div>
      {value && <span className="u-num" style={{ fontSize: 12, color: "var(--text-3)", flexShrink: 0 }}>{value}</span>}
      {interactive && <ChevronRight size={15} color="var(--text-3)" style={{ flexShrink: 0 }} />}
    </Comp>
  );
}

export const SYNC_COPY = {
  syncing: { icon: RefreshCw, tone: "gold", title: "Syncing…", body: "Sending your latest changes." },
  synced: { icon: Cloud, tone: "gold", title: "Everything's synced", body: "Your routine is safe on every device you sign in from." },
  offline: { icon: WifiOff, tone: "moon", title: "Offline", body: "Changes are saved on this phone and will sync when you're back." },
  error: { icon: CloudUpload, tone: "rose", title: "Couldn't sync", body: "Your data is safe here. Tap to try again." },
  idle: { icon: Cloud, tone: "gold", title: "Ready to sync", body: "Your routine syncs automatically as you use the app." },
};

export function SyncStatusCard({ status, lastSyncedAt, onSyncNow }) {
  const spec = SYNC_COPY[status] || SYNC_COPY.idle;
  const Icon = spec.icon;
  const when = lastSyncedAt ? timeAgo(lastSyncedAt) : null;
  const body = status === "synced" && when ? `Last synced ${when}.` : spec.body;
  return (
    <SettingRow
      icon={Icon}
      tone={spec.tone}
      title={spec.title}
      body={body}
      onClick={status === "error" || status === "synced" || status === "idle" ? onSyncNow : undefined}
    />
  );
}

export function DisplayNameSheet({ current, onSave, onClose }) {
  const [value, setValue] = useState(current || "");
  return (
    <Sheet onClose={onClose} z={155} labelledBy="name-title">
      <SheetHeader
        id="name-title"
        title="What should we call you?"
        subtitle="This is the name in your morning greeting."
        onClose={onClose}
      />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        maxLength={24}
        autoFocus
        aria-label="Display name"
        placeholder="Your name"
        style={{
          width: "100%", padding: "13px 14px", borderRadius: 14, marginBottom: 14,
          background: "rgba(255,255,255,0.04)", border: "1px solid var(--line-2)",
          color: "var(--text)", fontSize: 14,
        }}
      />
      <PrimaryButton onClick={() => { onSave(value); onClose(); }}>Save</PrimaryButton>
    </Sheet>
  );
}

/**
 * The guest-data-meets-account-data decision. It only ever appears on the first sign-in
 * from a phone that was already being used signed-out, and merging is offered first
 * because it's the only option that can't lose anything.
 */

/**
 * The guest-data-meets-account-data decision. It only ever appears on the first sign-in
 * from a phone that was already being used signed-out, and merging is offered first
 * because it's the only option that can't lose anything.
 */
export function SyncChoiceSheet({ local, remote, onChoose }) {
  const count = (s) => {
    const days = Object.keys(s.logs || {}).length;
    const items = (s.products || []).length;
    return `${plural(items, "product")} · ${plural(days, "logged day")}`;
  };
  return (
    <Sheet onClose={() => onChoose("merge")} z={158} labelledBy="choice-title">
      <SheetHeader
        id="choice-title"
        title="Two sets of data"
        subtitle="This phone has a routine on it, and so does your account. Nothing is deleted until you pick."
        onClose={() => onChoose("merge")}
      />
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {[["On this phone", count(local)], ["In your account", count(remote)]].map(([label, sub]) => (
          <div key={label} style={{
            flex: 1, borderRadius: 16, padding: "12px 13px",
            border: "1px solid var(--line)", background: "rgba(255,255,255,0.03)",
          }}>
            <div className="u-eyebrow">{label}</div>
            <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 6, lineHeight: 1.5 }}>{sub}</div>
          </div>
        ))}
      </div>
      <PrimaryButton onClick={() => onChoose("merge")} style={{ marginBottom: 8 }}>Merge both</PrimaryButton>
      <div style={{ display: "flex", gap: 8 }}>
        <GhostButton onClick={() => onChoose("local")} style={{ flex: 1 }}>Keep this phone's</GhostButton>
        <GhostButton onClick={() => onChoose("remote")} style={{ flex: 1 }}>Use my account's</GhostButton>
      </div>
    </Sheet>
  );
}

/**
 * Renders strictly from the authentication state, so it can never offer to sign in to
 * someone who already is, or hide a sign-out from someone who is signed in.
 *
 * @param {"guest"|"account"|"offline"} mode
 */

export function AvatarSheet({ hasPicture, onPick, onRemove, onClose }) {
  return (
    <Sheet onClose={onClose} z={155} labelledBy="avatar-title">
      <SheetHeader
        id="avatar-title"
        title="Profile picture"
        subtitle="Square-cropped and kept small — yours only."
        onClose={onClose}
      />
      <SettingRow
        icon={Camera}
        title={hasPicture ? "Choose a different picture" : "Choose a picture"}
        body="From your photos or camera roll."
        onClick={onPick}
      />
      {hasPicture && (
        <SettingRow
          icon={Trash2}
          danger
          title="Remove picture"
          body="Falls back to your initial."
          onClick={onRemove}
        />
      )}
    </Sheet>
  );
}

/**
 * Shown once per device when someone signs in with guest data sitting on the phone.
 * A brand-new account is offered the data; an account that already has a routine is told
 * plainly that nothing was merged, because silently combining two people's data — or two
 * of your own histories — is not recoverable.
 */

/**
 * Shown once per device when someone signs in with guest data sitting on the phone.
 * A brand-new account is offered the data; an account that already has a routine is told
 * plainly that nothing was merged, because silently combining two people's data — or two
 * of your own histories — is not recoverable.
 */
export function GuestOfferSheet({ mode, summary, onAnswer }) {
  const what = `${plural(summary.products, "product")} · ${plural(summary.days, "logged day")}`;
  if (mode === "new") {
    return (
      <Sheet onClose={() => onAnswer(false)} z={158} labelledBy="guest-offer-title">
        <SheetHeader
          id="guest-offer-title"
          title="Bring your routine with you?"
          subtitle="You'd been using Skinmaxxing without an account. That data is still on this phone."
          onClose={() => onAnswer(false)}
        />
        <div style={{
          borderRadius: 16, padding: "12px 14px", marginBottom: 16,
          border: "1px solid var(--line)", background: "rgba(255,255,255,0.03)",
        }}>
          <div className="u-eyebrow">On this phone</div>
          <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 6 }}>{what}</div>
        </div>
        <PrimaryButton onClick={() => onAnswer(true)} style={{ marginBottom: 8 }}>
          Bring it over
        </PrimaryButton>
        <GhostButton onClick={() => onAnswer(false)}>Start this account fresh</GhostButton>
        <p style={{ fontSize: 11, color: "var(--text-3)", textAlign: "center", margin: "12px 0 0", lineHeight: 1.55 }}>
          Either way nothing is deleted — the guest copy stays on this phone.
        </p>
      </Sheet>
    );
  }
  return (
    <Sheet onClose={() => onAnswer(false)} z={158} labelledBy="guest-offer-title">
      <SheetHeader
        id="guest-offer-title"
        title="This account already has a routine"
        subtitle="So we left the guest data on this phone alone rather than mixing the two together."
        onClose={() => onAnswer(false)}
      />
      <div style={{
        borderRadius: 16, padding: "12px 14px", marginBottom: 16,
        border: "1px solid var(--line)", background: "rgba(255,255,255,0.03)",
      }}>
        <div className="u-eyebrow">Still on this phone, untouched</div>
        <div style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 6 }}>{what}</div>
        <div style={{ fontSize: 11.5, color: "var(--text-3)", marginTop: 8, lineHeight: 1.55 }}>
          Sign out and choose "Continue without an account" to get back to it.
        </div>
      </div>
      <PrimaryButton onClick={() => onAnswer(false)}>Got it</PrimaryButton>
    </Sheet>
  );
}

/* --------------------------------- tab bar --------------------------------- */

/**
 * Renders strictly from the authentication state, so it can never offer to sign in to
 * someone who already is, or hide a sign-out from someone who is signed in.
 *
 * @param {"guest"|"account"|"offline"} mode
 */
export function AccountView({
  profile, mode, authEnabled, displayName, greetingName, monogram, avatarDataUrl,
  products, logs, syncStatus, lastSyncedAt, onSyncNow, onSetDisplayName,
  onExport, quotaUsedMB, quotaPct, quotaTotalMB,
  onClose, onSignIn, onSignOut, onExitGuest, onDeleteEverything,
  onPickAvatar, onRemoveAvatar,
}) {
  const reduce = useReducedMotion();
  const [showExport, setShowExport] = useState(false);
  const [showName, setShowName] = useState(false);
  const [showAvatarSheet, setShowAvatarSheet] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [confirmExitGuest, setConfirmExitGuest] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wipeError, setWipeError] = useState(null);
  const [googleAvatarBroken, setGoogleAvatarBroken] = useState(false);

  const isGuest = mode === "guest";
  const isOffline = mode === "offline";

  const stats = useMemo(() => {
    const dates = Object.keys(logs || {});
    const scored = dates.map((d) => dayCompletionPct(d, logs, products)).filter((p) => p > 0);
    const rate = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0;
    return { days: scored.length, streak: currentStreakDays(logs, products), rate };
  }, [logs, products]);

  const since = useMemo(() => {
    const iso = (!isGuest && profile?.createdAt) || Object.keys(logs || {}).sort()[0];
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  }, [profile, logs, isGuest]);

  // Uploaded picture wins, then whatever Google gave us, then the monogram.
  const avatarSrc = avatarDataUrl || (!googleAvatarBroken && !isGuest ? profile?.avatarUrl : "") || "";
  const hasOwnAvatar = !!avatarDataUrl;

  const knownName = greetingName || (!isGuest && profile?.fullName) || "";
  const hasName = !!knownName;
  const shownName = knownName || "Add your name";

  return (
    <motion.div
      initial={{ x: reduce ? 0 : "100%", opacity: reduce ? 0 : 1 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: reduce ? 0 : "100%", opacity: reduce ? 0 : 1 }}
      transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 330, damping: 36 }}
      role="dialog"
      aria-modal="true"
      aria-label="Your account"
      style={{
        position: "fixed", inset: 0, zIndex: 120, maxWidth: 480, margin: "0 auto",
        background: "var(--ink-0)", overflowY: "auto", WebkitOverflowScrolling: "touch",
      }}
    >
      <div style={{
        position: "sticky", top: 0, zIndex: 2,
        display: "flex", alignItems: "center", gap: 12,
        padding: "calc(16px + env(safe-area-inset-top)) 20px 14px",
        background: "linear-gradient(180deg, var(--ink-0) 62%, transparent)",
      }}>
        <button onClick={onClose} aria-label="Back" className="u-tap" style={iconBtnStyle}>
          <ArrowLeft size={15} color="var(--text-2)" />
        </button>
        <span className="u-eyebrow">Account</span>
      </div>

      <div style={{ padding: "6px 20px calc(40px + env(safe-area-inset-bottom))" }}>
        <Stagger>
          <StaggerItem>
            <div style={{ textAlign: "center", paddingBottom: 24 }}>
              <motion.button
                onClick={() => setShowAvatarSheet(true)}
                whileTap={{ scale: 0.96 }}
                transition={SPRING}
                aria-label={hasOwnAvatar ? "Change your profile picture" : "Add a profile picture"}
                className="u-tap"
                style={{
                  position: "relative", width: 78, height: 78, borderRadius: 999,
                  margin: "0 auto 14px", padding: 0, overflow: "visible",
                  border: "1px solid var(--line-3)", background: "var(--gold-wash)",
                  display: "block", boxShadow: "0 14px 34px -18px rgba(243,201,140,0.5)",
                }}
              >
                <span style={{
                  position: "absolute", inset: 0, borderRadius: 999, overflow: "hidden",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {avatarSrc ? (
                    <img
                      src={avatarSrc} alt="" referrerPolicy="no-referrer"
                      onError={() => setGoogleAvatarBroken(true)}
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  ) : (
                    <span className="u-display" style={{ fontSize: 32, color: "var(--gold)" }}>{monogram || "S"}</span>
                  )}
                </span>
                <span aria-hidden="true" style={{
                  position: "absolute", right: -2, bottom: -2,
                  width: 26, height: 26, borderRadius: 999,
                  background: "var(--ink-1)", border: "1px solid var(--line-2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  <Camera size={12} color="var(--gold)" />
                </span>
              </motion.button>

              {/* The name is the thing people actually want to change, so it's the
                  control. A guest with no name got a dead "You" here and had to find the
                  Preferences row to do anything about it — which nobody did. */}
              <div style={{ display: "flex", justifyContent: "center" }}>
                <motion.button
                  onClick={() => setShowName(true)}
                  whileTap={{ scale: 0.97 }}
                  transition={SPRING}
                  aria-label={hasName ? "Change your name" : "Add your name"}
                  className="u-tap"
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 9,
                    background: "none", border: "none", padding: "1px 2px",
                  }}
                >
                  <span className="u-display" style={{
                    fontSize: 27, color: hasName ? "var(--text)" : "var(--text-2)",
                  }}>
                    {shownName}
                  </span>
                  <Pencil size={13} color="var(--text-3)" style={{ flexShrink: 0 }} />
                </motion.button>
              </div>
              <div style={{ fontSize: 12.5, color: "var(--text-3)", marginTop: 6 }}>
                {isGuest ? "Not signed in — everything is on this phone" : profile?.email}
              </div>
              {since && <div className="u-eyebrow" style={{ marginTop: 12 }}>Since {since}</div>}
            </div>
          </StaggerItem>

          <StaggerItem>
            <div className="u-hairline" style={{ marginBottom: 20 }} />
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginBottom: 28 }}>
              <Stat value={stats.days} label="Days" size={30} />
              <Stat value={stats.streak} label="Streak" size={30} tone="gold" />
              <Stat value={stats.rate} unit="%" label="Completion" size={30} />
            </div>
          </StaggerItem>

          <StaggerItem>
            <Section title={isGuest ? "Your data" : "Sync"}>
              {isGuest && (
                <SettingRow
                  icon={CloudUpload}
                  title={authEnabled ? "Sign in to sync" : "Sync isn't set up on this build"}
                  body={authEnabled
                    ? "Back this routine up and pick it up on any other device. Your data stays here either way."
                    : "This copy runs entirely on your device."}
                  onClick={authEnabled ? onSignIn : undefined}
                />
              )}
              {isOffline && (
                <SettingRow
                  icon={WifiOff}
                  tone="moon"
                  title="Offline"
                  body="You're signed in, but we can't reach your account right now. Everything you do is saved here and syncs when you're back."
                />
              )}
              {mode === "account" && (
                <SyncStatusCard status={syncStatus} lastSyncedAt={lastSyncedAt} onSyncNow={onSyncNow} />
              )}
            </Section>
          </StaggerItem>

          <StaggerItem>
            <Section title="Preferences">
              <SettingRow
                icon={Pencil}
                title="Display name"
                body="The name in your morning greeting."
                value={displayName || greetingName || "Not set"}
                onClick={() => setShowName(true)}
              />
              <SettingRow
                icon={Download}
                title="Export your data"
                body="Every product, day, mood and note as JSON."
                onClick={() => setShowExport(true)}
              />
            </Section>
          </StaggerItem>

          <StaggerItem>
            <Section
              title="Storage"
              hint={isGuest
                ? "Photos live on this phone only. Sign in and they're backed up too."
                : "What this site is using on this device — your photos are safe in the cloud."}
            >
              <StorageMeter usedMB={quotaUsedMB} pct={quotaPct} totalMB={quotaTotalMB} />
            </Section>
          </StaggerItem>

          <StaggerItem>
            <Section title="Account">
              {isGuest ? (
                <SettingRow
                  icon={LogOut}
                  title="Exit guest mode"
                  body="Go back to the sign-in screen. Your data stays on this phone."
                  onClick={() => setConfirmExitGuest(true)}
                />
              ) : (
                <SettingRow
                  icon={LogOut}
                  title="Sign out"
                  body="Your data stays on this phone for next time."
                  onClick={onSignOut}
                />
              )}
              <SettingRow
                icon={Trash2}
                danger
                title="Delete everything"
                body={isGuest
                  ? "Wipes every product, day and photo on this phone."
                  : "Wipes your routine here and in your account. This can't be undone."}
                onClick={() => setConfirmWipe(true)}
              />
            </Section>
          </StaggerItem>
        </Stagger>
      </div>

      <AnimatePresence>
        {showExport && <ExportSheet onClose={() => setShowExport(false)} onExportJSON={onExport} />}
      </AnimatePresence>
      <AnimatePresence>
        {showName && (
          <DisplayNameSheet
            current={displayName || greetingName}
            onSave={onSetDisplayName}
            onClose={() => setShowName(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showAvatarSheet && (
          <AvatarSheet
            hasPicture={hasOwnAvatar}
            onPick={() => { setShowAvatarSheet(false); onPickAvatar(); }}
            onRemove={async () => { setShowAvatarSheet(false); await onRemoveAvatar(); }}
            onClose={() => setShowAvatarSheet(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {confirmExitGuest && (
          <ConfirmModal
            title="Leave guest mode?"
            body="Your routine is only on this phone. It'll still be here when you come back, but clearing your browser data, switching devices or losing this phone would take it with them — signing in with Google is what makes it recoverable."
            confirmLabel="Leave guest mode"
            onCancel={() => setConfirmExitGuest(false)}
            onConfirm={() => { setConfirmExitGuest(false); onExitGuest(); }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {confirmWipe && (
          <ConfirmModal
            title="Delete everything?"
            body={wipeError || (isGuest
              ? "Every product, logged day and progress photo on this phone will be permanently removed."
              : "Every product, logged day and progress photo will be permanently removed from this phone and from your account.")}
            confirmLabel={wiping ? "Deleting…" : "Delete it all"}
            onCancel={() => { setConfirmWipe(false); setWipeError(null); }}
            onConfirm={async () => {
              if (wiping) return;
              setWiping(true);
              setWipeError(null);
              const r = await onDeleteEverything();
              // A failed remote wipe leaves everything intact on purpose — say so rather
              // than reporting success and letting the next sync restore it all.
              if (r && r.ok === false) { setWipeError(r.error); setWiping(false); }
            }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
