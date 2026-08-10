import {
  Circle,
  Droplet,
  Eye,
  Flame,
  FlaskConical,
  Layers,
  Smile,
  Sparkles,
  Sun,
} from "lucide-react";

/* ---------------------------------- utils ---------------------------------- */

export const CATS = [
  { id: "cleanser", label: "Cleanser", icon: Droplet },
  { id: "toner", label: "Toner", icon: Sparkles },
  { id: "serum", label: "Serum", icon: FlaskConical },
  { id: "treatment", label: "Treatment", icon: Flame },
  { id: "eyecream", label: "Eye Cream", icon: Eye },
  { id: "lipcare", label: "Lip Care", icon: Smile },
  { id: "moisturizer", label: "Moisturizer", icon: Layers },
  { id: "sunscreen", label: "Sunscreen", icon: Sun },
  { id: "other", label: "Other", icon: Circle },
];

export const STATUS_OPTIONS = ["active", "trying", "retired"];

export const MOODS = ["Great", "Okay", "Dry", "Breakout", "Irritated"];

export const NEGATIVE_MOODS = ["Dry", "Irritated"];

export const QUOTES = [
  "Consistency is the highest form of self-care.",
  "Small steps, every day, become glass skin.",
  "Your barrier remembers patience.",
  "Barrier first, glow follows.",
  "Discipline today, dewy skin tomorrow.",
  "The best routine is the one you actually finish.",
  "Skin doesn't change overnight — it changes on nights like this.",
];

/* ------------------------------- products view ------------------------------- */

export const FILTERS = [
  { id: "all", label: "All" },
  { id: "am", label: "Morning" },
  { id: "pm", label: "Night" },
  { id: "tracked", label: "Tracked" },
  { id: "exfoliant", label: "Actives" },
  { id: "retired", label: "Retired" },
];

export function matchesFilter(p, filter) {
  if (filter === "all") return p.status !== "retired";
  if (filter === "retired") return p.status === "retired";
  if (filter === "tracked") return p.tracked && p.status !== "retired";
  if (filter === "exfoliant") return p.exfoliant && p.status !== "retired";
  if (filter === "am") return (p.time === "AM" || p.time === "Both") && p.status !== "retired";
  if (filter === "pm") return (p.time === "PM" || p.time === "Both") && p.status !== "retired";
  return true;
}

// AM/PM presence, in the same two temperatures used everywhere else.
