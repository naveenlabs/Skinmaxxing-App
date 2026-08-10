// Design tokens, motion springs, and the one global stylesheet.
import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { Eyebrow } from "../components/primitives.jsx";

/*
  Palette note — every colour below was sampled out of the header photographs rather
  than picked in the abstract. The warm images (hero, shelf, journey, insights) sit on
  hue ~24 terracotta with pale champagne highlights around hsl(34 90% 80%); the two PM
  images sit on hue ~216 steel blue with hsl(215 40% 75%) moonlight. So the app runs a
  deliberate dual temperature: gold for morning, moonlight for night, on a warm umber
  substrate — which is also exactly the AM/PM distinction the product is built around.
*/
export const GLOBAL_CSS = `
  :root {
    --ink-0: #0A0705;
    --ink-1: #100B08;
    --ink-2: #17100C;
    --ink-3: #201711;
    --ink-4: #2B1F17;

    --line: rgba(243,201,140,0.10);
    --line-2: rgba(243,201,140,0.18);
    --line-3: rgba(243,201,140,0.30);

    --text: #F8F2E9;
    --text-2: #CBBCAB;
    --text-3: #8D7F71;

    --gold: #F3C98C;
    --gold-2: #E0AC66;
    --gold-3: #B8853F;
    --gold-wash: rgba(243,201,140,0.09);
    --gold-wash-2: rgba(243,201,140,0.16);

    --moon: #A8BEDC;
    --moon-2: #7B95BA;
    --moon-wash: rgba(168,190,220,0.10);

    --rose: #E2A08D;
    --rose-wash: rgba(226,160,141,0.12);
    --sage: #A9BE9B;

    --r-sm: 12px;
    --r-md: 18px;
    --r-lg: 24px;
    --r-xl: 30px;

    --shadow-card: 0 1px 0 rgba(255,255,255,0.03) inset, 0 12px 28px -14px rgba(0,0,0,0.8);
    --shadow-lift: 0 20px 50px -20px rgba(0,0,0,0.9);

    --ease: cubic-bezier(0.22, 1, 0.36, 1);

    --font-ui: 'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', -apple-system, system-ui, sans-serif;
    --font-display: 'Instrument Serif', 'Times New Roman', serif;
  }

  * { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; }

  ::-webkit-scrollbar { width: 0; height: 0; }
  #root { scrollbar-width: none; }

  .u-display {
    font-family: var(--font-display);
    font-weight: 400;
    letter-spacing: -0.015em;
    line-height: 1.04;
  }
  /* Numbers align in columns without needing a monospace family — the old design used a
     mono face purely for this, which read more "terminal" than "premium". */
  .u-num { font-variant-numeric: tabular-nums; font-feature-settings: "tnum"; }

  /* Eyebrow labels: one definition, used on every page. Previously each page invented
     its own size/tracking/colour for the same role. */
  .u-eyebrow {
    font-family: var(--font-ui);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.16em;
    text-transform: uppercase;
    color: var(--text-3);
  }

  .u-card {
    background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018));
    border: 1px solid var(--line);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-card);
  }

  /* Frosted panel used for sheets and the tab bar */
  .u-frost {
    background: rgba(16,11,8,0.82);
    backdrop-filter: blur(28px) saturate(1.3);
    -webkit-backdrop-filter: blur(28px) saturate(1.3);
  }

  .u-hairline { height: 1px; background: linear-gradient(90deg, transparent, var(--line-2) 18%, var(--line-2) 82%, transparent); }

  button { font-family: inherit; color: inherit; }
  button:not(:disabled) { cursor: pointer; }
  input, textarea, select { font-family: inherit; }
  textarea:focus, input:focus, select:focus { outline: none; }
  /* keyboard focus was falling back to the browser's blue ring, which is the one colour
     nothing else on screen uses */
  :focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
  textarea:focus-visible, input:focus-visible { outline: 2px solid var(--gold); outline-offset: 1px; }
  input[type="date"]::-webkit-calendar-picker-indicator { filter: invert(0.7); }
  input::placeholder, textarea::placeholder { color: var(--text-3); }

  .u-tap { -webkit-tap-highlight-color: transparent; }

  @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
  @keyframes spin { to { transform: rotate(360deg); } }
  .animate-spin { animation: spin 0.9s linear infinite; }

  /* Slow ambient drift on hero photography — barely perceptible, but it stops the
     headers reading as flat static images. */
  @keyframes heroDrift {
    0%   { transform: scale(1.06) translate3d(0, 0, 0); }
    100% { transform: scale(1.14) translate3d(-1.2%, -1.4%, 0); }
  }
  .u-hero-img { animation: heroDrift 34s ease-in-out infinite alternate; will-change: transform; }

  @media (prefers-reduced-motion: reduce) {
    .u-hero-img { animation: none; }
    .animate-spin { animation-duration: 2s; }
  }
`;

/* ------------------------------ design primitives ----------------------------- */

export const SPRING = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 };

export const SPRING_SOFT = { type: "spring", stiffness: 240, damping: 30 };

// Tone system: every AM/PM-flavoured surface reads from here instead of hard-coding
// gold or blue at each call site, which is how the two temperatures stayed consistent.

// Tone system: every AM/PM-flavoured surface reads from here instead of hard-coding
// gold or blue at each call site, which is how the two temperatures stayed consistent.
export const TONES = {
  gold: { fg: "var(--gold)", fgDeep: "var(--gold-2)", wash: "var(--gold-wash)", wash2: "var(--gold-wash-2)", line: "var(--line-3)", glow: "rgba(243,201,140,0.28)" },
  moon: { fg: "var(--moon)", fgDeep: "var(--moon-2)", wash: "var(--moon-wash)", wash2: "rgba(168,190,220,0.18)", line: "rgba(168,190,220,0.32)", glow: "rgba(168,190,220,0.26)" },
  // signal tone — for "this needs attention", never for AM/PM. Keeping it separate stops
  // negative states borrowing the night colour and muddling the two meanings.
  rose: { fg: "var(--rose)", fgDeep: "#C9836E", wash: "var(--rose-wash)", wash2: "rgba(226,160,141,0.2)", line: "rgba(226,160,141,0.3)", glow: "rgba(226,160,141,0.28)" },
};
